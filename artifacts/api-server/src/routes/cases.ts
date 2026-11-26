import { Router, type IRouter } from "express";
import { and, eq, sql } from "drizzle-orm";
import {
  db,
  casesTable,
  investigationPeriodsTable,
  caseSharesTable,
  bankAccountsTable,
  bankStatementsTable,
  transactionsTable,
  assetsTable,
  liabilitiesTable,
  familyMembersTable,
  documentsTable,
  investigationQueriesTable,
} from "@workspace/db";
import {
  CreateCaseBody,
  UpdateCaseBody,
  CreatePeriodBody,
  CreateCaseShareBody,
  ListCasesQueryParams,
} from "@workspace/api-zod";
import { accessibleCases, currentUser, intParam, loadCase } from "../lib/access";
import { audit, diff } from "../lib/audit";
import { serializeCase } from "../lib/serialize";
import { round2 } from "../lib/finance";

const router: IRouter = Router();

router.get("/cases", async (req, res): Promise<void> => {
  const q = ListCasesQueryParams.safeParse(req.query);
  if (!q.success) {
    res.status(400).json({ error: q.error.message });
    return;
  }
  let rows = await accessibleCases(currentUser(req));
  const { search, status, caseType } = q.data;
  if (status) rows = rows.filter((r) => r.c.status === status);
  if (caseType) rows = rows.filter((r) => r.c.caseType === caseType);
  if (search) {
    const s = search.toLowerCase();
    rows = rows.filter((r) => [r.c.title, r.c.referenceNumber, r.c.subjectName, r.c.investigatingAuthority].some((v) => v?.toLowerCase().includes(s)));
  }
  rows.sort((a, b) => b.c.createdAt.getTime() - a.c.createdAt.getTime());
  res.json(rows.map((r) => serializeCase(r.c, r.role)));
});

router.post("/cases", async (req, res): Promise<void> => {
  const parsed = CreateCaseBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const user = currentUser(req);
  const [c] = await db.insert(casesTable).values({ ...parsed.data, ownerId: user.id }).returning();
  await audit(req, { caseId: c!.id, caseTitle: c!.title, action: "case.created", entityType: "case", entityId: c!.id, summary: `Created case "${c!.title}"`, next: parsed.data });
  res.status(201).json(serializeCase(c!, "owner"));
});

router.get("/cases/:caseId", async (req, res): Promise<void> => {
  const ctx = await loadCase(req, res, intParam(req, "caseId"));
  if (!ctx) return;
  res.json(serializeCase(ctx.c, ctx.role));
});

router.patch("/cases/:caseId", async (req, res): Promise<void> => {
  const ctx = await loadCase(req, res, intParam(req, "caseId"), "edit");
  if (!ctx) return;
  const parsed = UpdateCaseBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const [c] = await db.update(casesTable).set(parsed.data).where(eq(casesTable.id, ctx.c.id)).returning();
  const d = diff(ctx.c as unknown as Record<string, unknown>, parsed.data);
  await audit(req, { caseId: c!.id, caseTitle: c!.title, action: "case.updated", entityType: "case", entityId: c!.id, summary: `Updated ${Object.keys(d.next).join(", ") || "no fields"}`, previous: d.previous, next: d.next });
  res.json(serializeCase(c!, ctx.role));
});

router.delete("/cases/:caseId", async (req, res): Promise<void> => {
  const ctx = await loadCase(req, res, intParam(req, "caseId"), "owner");
  if (!ctx) return;
  await db.delete(casesTable).where(eq(casesTable.id, ctx.c.id));
  await audit(req, { caseId: ctx.c.id, caseTitle: ctx.c.title, action: "case.deleted", entityType: "case", entityId: ctx.c.id, summary: `Deleted case "${ctx.c.title}"` });
  res.sendStatus(204);
});

router.get("/cases/:caseId/summary", async (req, res): Promise<void> => {
  const ctx = await loadCase(req, res, intParam(req, "caseId"));
  if (!ctx) return;
  const id = ctx.c.id;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const count = async (t: any, where: any): Promise<number> => {
    const r = await db.select({ n: sql<number>`count(*)::int` }).from(t).where(where);
    return r[0]?.n ?? 0;
  };
  const [bankAccounts, statements, familyMembers, documents, openQueries, txns, assets, liabilities] = await Promise.all([
    count(bankAccountsTable, eq(bankAccountsTable.caseId, id)),
    count(bankStatementsTable, eq(bankStatementsTable.caseId, id)),
    count(familyMembersTable, eq(familyMembersTable.caseId, id)),
    count(documentsTable, and(eq(documentsTable.caseId, id), eq(documentsTable.isArchived, false))),
    count(investigationQueriesTable, and(eq(investigationQueriesTable.caseId, id), sql`${investigationQueriesTable.status} not in ('reviewed','closed')`)),
    db
      .select({
        credit: transactionsTable.credit,
        debit: transactionsTable.debit,
        category: transactionsTable.category,
        classificationStatus: transactionsTable.classificationStatus,
        reconciliationStatus: transactionsTable.reconciliationStatus,
        financialYear: transactionsTable.financialYear,
      })
      .from(transactionsTable)
      .where(eq(transactionsTable.caseId, id)),
    db.select().from(assetsTable).where(eq(assetsTable.caseId, id)),
    db.select().from(liabilitiesTable).where(eq(liabilitiesTable.caseId, id)),
  ]);
  const cats = new Map<string, { credits: number; debits: number; count: number }>();
  for (const t of txns) {
    const k = t.category ?? "uncategorised";
    const g = cats.get(k) ?? { credits: 0, debits: 0, count: 0 };
    g.credits += t.credit;
    g.debits += t.debit;
    g.count++;
    cats.set(k, g);
  }
  res.json({
    caseId: id,
    bankAccounts,
    statements,
    transactions: txns.length,
    totalCredits: round2(txns.reduce((s, t) => s + t.credit, 0)),
    totalDebits: round2(txns.reduce((s, t) => s + t.debit, 0)),
    unclassified: txns.filter((t) => t.classificationStatus === "unclassified").length,
    suggested: txns.filter((t) => t.classificationStatus === "suggested").length,
    unreconciled: txns.filter((t) => t.reconciliationStatus === "unreconciled").length,
    assetsValue: round2(assets.filter((a) => !a.disposalDate).reduce((s, a) => s + (a.currentValuation ?? a.purchasePrice ?? 0), 0)),
    liabilitiesValue: round2(liabilities.reduce((s, l) => s + (l.outstandingAtEnd ?? l.principalAmount ?? 0), 0)),
    familyMembers,
    documents,
    openQueries,
    financialYears: [...new Set(txns.map((t) => t.financialYear))].sort(),
    categoryBreakdown: [...cats.entries()]
      .map(([category, g]) => ({ category, credits: round2(g.credits), debits: round2(g.debits), count: g.count }))
      .sort((a, b) => b.credits + b.debits - (a.credits + a.debits)),
  });
});

router.get("/cases/:caseId/periods", async (req, res): Promise<void> => {
  const ctx = await loadCase(req, res, intParam(req, "caseId"));
  if (!ctx) return;
  const rows = await db.select().from(investigationPeriodsTable).where(eq(investigationPeriodsTable.caseId, ctx.c.id)).orderBy(investigationPeriodsTable.startDate);
  res.json(rows);
});

router.post("/cases/:caseId/periods", async (req, res): Promise<void> => {
  const ctx = await loadCase(req, res, intParam(req, "caseId"), "edit");
  if (!ctx) return;
  const parsed = CreatePeriodBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  if (parsed.data.endDate < parsed.data.startDate) {
    res.status(400).json({ error: "End date must be on or after start date" });
    return;
  }
  if (parsed.data.periodType === "check_period") {
    const [existing] = await db
      .select()
      .from(investigationPeriodsTable)
      .where(and(eq(investigationPeriodsTable.caseId, ctx.c.id), eq(investigationPeriodsTable.periodType, "check_period")));
    if (existing) {
      res.status(409).json({ error: "A check period already exists for this case. Delete it before adding another." });
      return;
    }
  }
  const [p] = await db.insert(investigationPeriodsTable).values({ ...parsed.data, caseId: ctx.c.id }).returning();
  await audit(req, { caseId: ctx.c.id, caseTitle: ctx.c.title, action: "period.created", entityType: "period", entityId: p!.id, summary: `Added ${p!.periodType.replace(/_/g, " ")} ${p!.startDate} to ${p!.endDate}`, next: parsed.data });
  res.status(201).json(p);
});

router.delete("/periods/:periodId", async (req, res): Promise<void> => {
  const [p] = await db.select().from(investigationPeriodsTable).where(eq(investigationPeriodsTable.id, intParam(req, "periodId")));
  if (!p) {
    res.status(404).json({ error: "Period not found" });
    return;
  }
  const ctx = await loadCase(req, res, p.caseId, "edit");
  if (!ctx) return;
  await db.delete(investigationPeriodsTable).where(eq(investigationPeriodsTable.id, p.id));
  await audit(req, { caseId: ctx.c.id, caseTitle: ctx.c.title, action: "period.deleted", entityType: "period", entityId: p.id, summary: `Removed period "${p.label}"`, previous: p });
  res.sendStatus(204);
});

router.get("/cases/:caseId/shares", async (req, res): Promise<void> => {
  const ctx = await loadCase(req, res, intParam(req, "caseId"));
  if (!ctx) return;
  const rows = await db.select().from(caseSharesTable).where(eq(caseSharesTable.caseId, ctx.c.id)).orderBy(caseSharesTable.createdAt);
  res.json(rows);
});

router.post("/cases/:caseId/shares", async (req, res): Promise<void> => {
  const ctx = await loadCase(req, res, intParam(req, "caseId"), "owner");
  if (!ctx) return;
  const parsed = CreateCaseShareBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const email = parsed.data.email.trim().toLowerCase();
  if (email === ctx.user.email.toLowerCase()) {
    res.status(400).json({ error: "You already own this case" });
    return;
  }
  const [dup] = await db.select().from(caseSharesTable).where(and(eq(caseSharesTable.caseId, ctx.c.id), eq(caseSharesTable.email, email)));
  if (dup) {
    res.status(409).json({ error: "This case is already shared with that email. Revoke the existing share to change the role." });
    return;
  }
  const [s] = await db
    .insert(caseSharesTable)
    .values({ caseId: ctx.c.id, email, accessRole: parsed.data.accessRole, note: parsed.data.note ?? null, createdBy: ctx.user.displayName })
    .returning();
  await audit(req, {
    caseId: ctx.c.id,
    caseTitle: ctx.c.title,
    action: "case.shared",
    entityType: "case_share",
    entityId: s!.id,
    summary: `Shared case with ${email} as ${parsed.data.accessRole}`,
    next: { email, accessRole: parsed.data.accessRole, note: parsed.data.note ?? null },
  });
  res.status(201).json(s);
});

router.delete("/shares/:shareId", async (req, res): Promise<void> => {
  const [s] = await db.select().from(caseSharesTable).where(eq(caseSharesTable.id, intParam(req, "shareId")));
  if (!s) {
    res.status(404).json({ error: "Share not found" });
    return;
  }
  const ctx = await loadCase(req, res, s.caseId, "owner");
  if (!ctx) return;
  await db.delete(caseSharesTable).where(eq(caseSharesTable.id, s.id));
  await audit(req, { caseId: ctx.c.id, caseTitle: ctx.c.title, action: "case.share_revoked", entityType: "case_share", entityId: s.id, summary: `Revoked access for ${s.email} (${s.accessRole})`, previous: s });
  res.sendStatus(204);
});

export default router;
