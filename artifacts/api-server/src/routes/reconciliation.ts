import { Router, type IRouter } from "express";
import { and, desc, eq, inArray } from "drizzle-orm";
import { db, transactionMatchesTable, transactionsTable } from "@workspace/db";
import { CreateManualMatchBody, ReviewMatchBody, ListMatchesQueryParams } from "@workspace/api-zod";
import { intParam, loadCase } from "../lib/access";
import { audit } from "../lib/audit";
import { serializeTxns } from "../lib/serialize";
import { excludedTransferIds, recomputeReconciliationStatus, runMatching } from "../lib/reconcile";
import { daysBetween, round2 } from "../lib/finance";

const router: IRouter = Router();

type MatchRow = typeof transactionMatchesTable.$inferSelect;

async function hydrate(caseId: number, matches: MatchRow[]) {
  const ids = [...new Set(matches.flatMap((m) => [...m.sourceIds, ...m.targetIds]))];
  const txns = ids.length ? await db.select().from(transactionsTable).where(inArray(transactionsTable.id, ids)) : [];
  const ser = await serializeTxns(caseId, txns);
  const byId = new Map(ser.map((t) => [t.id, t]));
  return matches.map(({ sourceIds, targetIds, createdAt: _c, ...m }) => ({
    ...m,
    sourceTransactions: sourceIds.map((i) => byId.get(i)).filter(Boolean),
    targetTransactions: targetIds.map((i) => byId.get(i)).filter(Boolean),
  }));
}

router.post("/cases/:caseId/reconciliation/run", async (req, res): Promise<void> => {
  const ctx = await loadCase(req, res, intParam(req, "caseId"), "edit");
  if (!ctx) return;
  const n = await runMatching(ctx.c.id);
  await audit(req, { caseId: ctx.c.id, caseTitle: ctx.c.title, action: "reconciliation.run", entityType: "reconciliation", summary: `Matching engine proposed ${n} match(es) for review` });
  res.json({ count: n, message: `${n} suggested match(es). Matches establish movement of funds only, not their legal character.` });
});

router.get("/cases/:caseId/reconciliation/summary", async (req, res): Promise<void> => {
  const ctx = await loadCase(req, res, intParam(req, "caseId"));
  if (!ctx) return;
  const txns = await db.select({ s: transactionsTable.reconciliationStatus, cr: transactionsTable.credit, dr: transactionsTable.debit, id: transactionsTable.id }).from(transactionsTable).where(eq(transactionsTable.caseId, ctx.c.id));
  const matches = await db.select({ s: transactionMatchesTable.status }).from(transactionMatchesTable).where(eq(transactionMatchesTable.caseId, ctx.c.id));
  const excluded = await excludedTransferIds(ctx.c.id);
  const count = (s: string) => txns.filter((t) => t.s === s).length;
  const mcount = (s: string) => matches.filter((m) => m.s === s).length;
  res.json({
    reconciled: count("reconciled"),
    partiallyReconciled: count("partially_reconciled"),
    unreconciled: count("unreconciled"),
    manualReview: count("manual_review"),
    suggestedMatches: mcount("suggested"),
    approvedMatches: mcount("approved"),
    rejectedMatches: mcount("rejected"),
    // Each approved transfer has two legs; count the moved amount once.
    excludedTransferAmount: round2(txns.filter((t) => excluded.has(t.id)).reduce((s, t) => s + t.cr, 0)),
  });
});

router.get("/cases/:caseId/matches", async (req, res): Promise<void> => {
  const ctx = await loadCase(req, res, intParam(req, "caseId"));
  if (!ctx) return;
  const q = ListMatchesQueryParams.safeParse(req.query);
  if (!q.success) {
    res.status(400).json({ error: q.error.message });
    return;
  }
  const conds = [eq(transactionMatchesTable.caseId, ctx.c.id)];
  if (q.data.status) conds.push(eq(transactionMatchesTable.status, q.data.status));
  const rows = await db.select().from(transactionMatchesTable).where(and(...conds)).orderBy(desc(transactionMatchesTable.confidence), transactionMatchesTable.id);
  res.json(await hydrate(ctx.c.id, rows));
});

router.post("/cases/:caseId/matches", async (req, res): Promise<void> => {
  const ctx = await loadCase(req, res, intParam(req, "caseId"), "edit");
  if (!ctx) return;
  const parsed = CreateManualMatchBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const { sourceTransactionIds: s, targetTransactionIds: t, matchType, reviewNote } = parsed.data;
  if (s.some((id) => t.includes(id))) {
    res.status(400).json({ error: "A transaction cannot be on both sides of a match" });
    return;
  }
  const all = await db.select().from(transactionsTable).where(inArray(transactionsTable.id, [...s, ...t]));
  if (all.length !== new Set([...s, ...t]).size || all.some((x) => x.caseId !== ctx.c.id)) {
    res.status(400).json({ error: "All transactions must belong to this case" });
    return;
  }
  const src = all.filter((x) => s.includes(x.id));
  const tgt = all.filter((x) => t.includes(x.id));
  const srcAmt = round2(src.reduce((a, x) => a + Math.max(x.debit, x.credit), 0));
  const tgtAmt = round2(tgt.reduce((a, x) => a + Math.max(x.debit, x.credit), 0));
  const dates = all.map((x) => x.txnDate).sort();
  const evidence = [
    "Manual match created by user",
    srcAmt === tgtAmt ? `Amounts agree: ${srcAmt.toFixed(2)}` : `Amounts differ: source ${srcAmt.toFixed(2)}, target ${tgtAmt.toFixed(2)}`,
  ];
  const [m] = await db
    .insert(transactionMatchesTable)
    .values({
      caseId: ctx.c.id,
      matchType,
      confidence: 100,
      status: srcAmt === tgtAmt ? "approved" : "partial",
      amount: Math.min(srcAmt, tgtAmt),
      dateGapDays: daysBetween(dates[0]!, dates[dates.length - 1]!),
      evidence,
      sourceIds: s,
      targetIds: t,
      reviewNote: reviewNote ?? null,
      createdBy: "user",
      reviewedAt: new Date(),
    })
    .returning();
  await recomputeReconciliationStatus(ctx.c.id);
  await audit(req, { caseId: ctx.c.id, caseTitle: ctx.c.title, action: "match.created_manual", entityType: "match", entityId: m!.id, summary: `Manual ${matchType.replace(/_/g, " ")} match of transactions ${[...s, ...t].join(", ")}`, next: { sourceIds: s, targetIds: t, reviewNote } });
  res.status(201).json((await hydrate(ctx.c.id, [m!]))[0]);
});

router.patch("/matches/:matchId", async (req, res): Promise<void> => {
  const [m] = await db.select().from(transactionMatchesTable).where(eq(transactionMatchesTable.id, intParam(req, "matchId")));
  if (!m) {
    res.status(404).json({ error: "Match not found" });
    return;
  }
  const ctx = await loadCase(req, res, m.caseId, "edit");
  if (!ctx) return;
  const parsed = ReviewMatchBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const [u] = await db
    .update(transactionMatchesTable)
    .set({ status: parsed.data.status, reviewNote: parsed.data.reviewNote ?? m.reviewNote, reviewedAt: new Date() })
    .where(eq(transactionMatchesTable.id, m.id))
    .returning();
  await recomputeReconciliationStatus(ctx.c.id);
  await audit(req, { caseId: ctx.c.id, caseTitle: ctx.c.title, action: `match.${parsed.data.status}`, entityType: "match", entityId: m.id, summary: `Marked ${m.matchType.replace(/_/g, " ")} match as ${parsed.data.status}${parsed.data.reviewNote ? `: ${parsed.data.reviewNote}` : ""}`, previous: { status: m.status }, next: { status: parsed.data.status } });
  res.json((await hydrate(ctx.c.id, [u!]))[0]);
});

export default router;
