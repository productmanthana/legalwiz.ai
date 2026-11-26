import { Router, type IRouter } from "express";
import { and, asc, desc, eq, gte, ilike, or, sql, type SQL } from "drizzle-orm";
import { db, transactionsTable, familyMembersTable, auditLogsTable, bankAccountsTable } from "@workspace/db";
import { ListTransactionsQueryParams, UpdateTransactionBody } from "@workspace/api-zod";
import { intParam, loadCase } from "../lib/access";
import { audit } from "../lib/audit";
import { serializeTxn, serializeTxns } from "../lib/serialize";
import { suggestCategory } from "../lib/classify";
import { financialYearOf, round2 } from "../lib/finance";

const router: IRouter = Router();

router.get("/cases/:caseId/transactions", async (req, res): Promise<void> => {
  const ctx = await loadCase(req, res, intParam(req, "caseId"));
  if (!ctx) return;
  const q = ListTransactionsQueryParams.safeParse(req.query);
  if (!q.success) {
    res.status(400).json({ error: q.error.message });
    return;
  }
  const f = q.data;
  const conds: SQL[] = [eq(transactionsTable.caseId, ctx.c.id)];
  if (f.accountId) conds.push(eq(transactionsTable.bankAccountId, f.accountId));
  if (f.category) conds.push(f.category === "uncategorised" ? sql`${transactionsTable.category} is null` : eq(transactionsTable.category, f.category));
  if (f.reviewStatus) conds.push(eq(transactionsTable.reviewStatus, f.reviewStatus));
  if (f.reconciliationStatus) conds.push(eq(transactionsTable.reconciliationStatus, f.reconciliationStatus));
  if (f.financialYear) conds.push(eq(transactionsTable.financialYear, f.financialYear));
  if (f.direction === "credit") conds.push(sql`${transactionsTable.credit} > 0`);
  if (f.direction === "debit") conds.push(sql`${transactionsTable.debit} > 0`);
  if (f.minAmount != null) conds.push(or(gte(transactionsTable.credit, f.minAmount), gte(transactionsTable.debit, f.minAmount))!);
  if (f.search) {
    const s = `%${f.search}%`;
    conds.push(or(ilike(transactionsTable.description, s), ilike(transactionsTable.referenceNumber, s), ilike(transactionsTable.explanation, s))!);
  }
  const rows = await db
    .select()
    .from(transactionsTable)
    .where(and(...conds))
    .orderBy(asc(transactionsTable.txnDate), asc(transactionsTable.id))
    .limit(5000);
  res.json(await serializeTxns(ctx.c.id, rows));
});

router.post("/cases/:caseId/transactions/suggest-classifications", async (req, res): Promise<void> => {
  const ctx = await loadCase(req, res, intParam(req, "caseId"), "edit");
  if (!ctx) return;
  const family = await db.select({ name: familyMembersTable.name }).from(familyMembersTable).where(eq(familyMembersTable.caseId, ctx.c.id));
  const rows = await db
    .select()
    .from(transactionsTable)
    .where(and(eq(transactionsTable.caseId, ctx.c.id), eq(transactionsTable.classificationStatus, "unclassified")));
  let n = 0;
  for (const t of rows) {
    const s = suggestCategory(t.description, t.debit, t.credit, family.map((f) => f.name));
    if (!s) continue;
    await db
      .update(transactionsTable)
      .set({ suggestedCategory: s.category, suggestionReason: `Rule-based suggestion: ${s.reason}`, classificationStatus: "suggested" })
      .where(eq(transactionsTable.id, t.id));
    n++;
  }
  await audit(req, { caseId: ctx.c.id, caseTitle: ctx.c.title, action: "transactions.suggested", entityType: "transaction", summary: `Generated ${n} classification suggestion(s) for ${rows.length} unclassified transaction(s). Suggestions require approval.` });
  res.json({ count: n, message: `${n} of ${rows.length} unclassified transactions received a suggestion. Review and approve each before it affects any schedule.` });
});

async function loadTxn(req: Parameters<typeof loadCase>[0], res: Parameters<typeof loadCase>[1], need: "read" | "edit") {
  const [t] = await db.select().from(transactionsTable).where(eq(transactionsTable.id, intParam(req, "transactionId")));
  if (!t) {
    res.status(404).json({ error: "Transaction not found" });
    return null;
  }
  const ctx = await loadCase(req, res, t.caseId, need);
  if (!ctx) return null;
  return { t, ctx };
}

router.get("/transactions/:transactionId", async (req, res): Promise<void> => {
  const r = await loadTxn(req, res, "read");
  if (!r) return;
  const { t } = r;
  const [acct] = await db.select().from(bankAccountsTable).where(eq(bankAccountsTable.id, t.bankAccountId));
  const history = await db
    .select()
    .from(auditLogsTable)
    .where(and(eq(auditLogsTable.entityType, "transaction"), eq(auditLogsTable.entityId, t.id)))
    .orderBy(desc(auditLogsTable.createdAt));
  res.json({
    ...serializeTxn(t, acct),
    original: { description: t.origDescription, debit: t.origDebit, credit: t.origCredit, txnDate: t.origTxnDate, balance: t.origBalance },
    history: history.map(({ userId: _u, ...h }) => h),
  });
});

router.patch("/transactions/:transactionId", async (req, res): Promise<void> => {
  const r = await loadTxn(req, res, "edit");
  if (!r) return;
  const { t, ctx } = r;
  const parsed = UpdateTransactionBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const b = parsed.data;
  const correcting = b.correctedDescription !== undefined || b.correctedDebit !== undefined || b.correctedCredit !== undefined || b.correctedTxnDate !== undefined;
  if (correcting && !b.correctionReason?.trim()) {
    res.status(400).json({ error: "A correction reason is required when changing imported values" });
    return;
  }
  const patch: Partial<typeof transactionsTable.$inferInsert> = {};
  if (b.category !== undefined) {
    patch.category = b.category;
    patch.classificationStatus = b.category ? "approved" : "unclassified";
    if (b.category) {
      patch.suggestedCategory = null;
      patch.suggestionReason = null;
    }
  }
  if (b.tags !== undefined) patch.tags = b.tags;
  if (b.explanation !== undefined) patch.explanation = b.explanation;
  if (b.familyMemberId !== undefined) patch.familyMemberId = b.familyMemberId;
  if (b.reviewStatus !== undefined) patch.reviewStatus = b.reviewStatus;
  if (b.documentIds !== undefined) patch.documentIds = b.documentIds;
  if (correcting) {
    if (b.correctedDescription !== undefined) patch.description = b.correctedDescription;
    if (b.correctedDebit !== undefined) patch.debit = round2(b.correctedDebit);
    if (b.correctedCredit !== undefined) patch.credit = round2(b.correctedCredit);
    if (b.correctedTxnDate !== undefined) {
      patch.txnDate = b.correctedTxnDate;
      patch.financialYear = financialYearOf(b.correctedTxnDate);
    }
    patch.isEdited = true;
  }
  const previous: Record<string, unknown> = {};
  const next: Record<string, unknown> = {};
  for (const k of Object.keys(patch) as (keyof typeof patch)[]) {
    const before = (t as Record<string, unknown>)[k];
    if (JSON.stringify(before) !== JSON.stringify(patch[k])) {
      previous[k] = before;
      next[k] = patch[k];
    }
  }
  const [u] = await db.update(transactionsTable).set(patch).where(eq(transactionsTable.id, t.id)).returning();
  await audit(req, {
    caseId: ctx.c.id,
    caseTitle: ctx.c.title,
    action: correcting ? "transaction.corrected" : "transaction.updated",
    entityType: "transaction",
    entityId: t.id,
    summary: correcting ? `Corrected imported values. Reason: ${b.correctionReason}` : `Updated ${Object.keys(next).join(", ") || "no fields"}`,
    previous,
    next,
  });
  const [acct] = await db.select().from(bankAccountsTable).where(eq(bankAccountsTable.id, u!.bankAccountId));
  res.json(serializeTxn(u!, acct));
});

router.post("/transactions/:transactionId/approve-suggestion", async (req, res): Promise<void> => {
  const r = await loadTxn(req, res, "edit");
  if (!r) return;
  const { t, ctx } = r;
  if (!t.suggestedCategory) {
    res.status(400).json({ error: "This transaction has no pending suggestion" });
    return;
  }
  const [u] = await db
    .update(transactionsTable)
    .set({ category: t.suggestedCategory, classificationStatus: "approved", suggestedCategory: null })
    .where(eq(transactionsTable.id, t.id))
    .returning();
  await audit(req, {
    caseId: ctx.c.id,
    caseTitle: ctx.c.title,
    action: "transaction.suggestion_approved",
    entityType: "transaction",
    entityId: t.id,
    summary: `Approved suggested category "${t.suggestedCategory}" (${t.suggestionReason ?? "no reason recorded"})`,
    previous: { category: t.category },
    next: { category: t.suggestedCategory },
  });
  const [acct] = await db.select().from(bankAccountsTable).where(eq(bankAccountsTable.id, u!.bankAccountId));
  res.json(serializeTxn(u!, acct));
});

export default router;
