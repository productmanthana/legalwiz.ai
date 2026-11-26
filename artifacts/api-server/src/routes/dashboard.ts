import { Router, type IRouter } from "express";
import { and, desc, eq, gte, inArray, isNotNull, or } from "drizzle-orm";
import {
  db,
  transactionsTable,
  bankAccountsTable,
  documentsTable,
  investigationQueriesTable,
  queryResponsesTable,
  auditLogsTable,
} from "@workspace/db";
import { accessibleCases, currentUser } from "../lib/access";
import { serializeDocs } from "../lib/serialize";
import { round2 } from "../lib/finance";

const router: IRouter = Router();

const CLOSED_QUERY = new Set(["reviewed", "closed"]);

router.get("/dashboard/summary", async (req, res): Promise<void> => {
  const cases = await accessibleCases(currentUser(req));
  const ids = cases.map((c) => c.c.id);
  const empty = {
    activeCases: 0, casesByType: [], bankAccounts: 0, transactions: 0, awaitingClassification: 0, awaitingReconciliation: 0,
    missingDocuments: 0, pendingQueries: 0, responsesAwaitingReview: 0, financialYears: [], documents: 0, recentDocuments: [],
  };
  if (ids.length === 0) {
    res.json(empty);
    return;
  }
  const [accounts, txns, docs, queries] = await Promise.all([
    db.select({ id: bankAccountsTable.id }).from(bankAccountsTable).where(inArray(bankAccountsTable.caseId, ids)),
    db
      .select({
        classificationStatus: transactionsTable.classificationStatus,
        reconciliationStatus: transactionsTable.reconciliationStatus,
        credit: transactionsTable.credit,
        debit: transactionsTable.debit,
        documentIds: transactionsTable.documentIds,
        financialYear: transactionsTable.financialYear,
      })
      .from(transactionsTable)
      .where(inArray(transactionsTable.caseId, ids)),
    db.select().from(documentsTable).where(and(inArray(documentsTable.caseId, ids), eq(documentsTable.isArchived, false))).orderBy(desc(documentsTable.createdAt)),
    db.select().from(investigationQueriesTable).where(inArray(investigationQueriesTable.caseId, ids)),
  ]);
  const qIds = queries.map((q) => q.id);
  const responses = qIds.length
    ? await db.select().from(queryResponsesTable).where(and(inArray(queryResponsesTable.queryId, qIds), or(eq(queryResponsesTable.status, "draft"), eq(queryResponsesTable.status, "submitted"), eq(queryResponsesTable.status, "under_review"))))
    : [];
  const byType = new Map<string, number>();
  for (const c of cases) if (c.c.status !== "closed") byType.set(c.c.caseType, (byType.get(c.c.caseType) ?? 0) + 1);
  res.json({
    activeCases: cases.filter((c) => c.c.status !== "closed").length,
    casesByType: [...byType.entries()].map(([caseType, count]) => ({ caseType, count })),
    bankAccounts: accounts.length,
    transactions: txns.length,
    awaitingClassification: txns.filter((t) => t.classificationStatus !== "approved").length,
    awaitingReconciliation: txns.filter((t) => t.reconciliationStatus === "unreconciled" || t.reconciliationStatus === "manual_review").length,
    missingDocuments: txns.filter((t) => Math.max(t.credit, t.debit) >= 100000 && t.documentIds.length === 0).length,
    pendingQueries: queries.filter((q) => !CLOSED_QUERY.has(q.status)).length,
    responsesAwaitingReview: responses.length,
    financialYears: [...new Set(txns.map((t) => t.financialYear))].sort(),
    documents: docs.length,
    recentDocuments: serializeDocs(docs.slice(0, 6), docs),
  });
});

router.get("/dashboard/financial-overview", async (req, res): Promise<void> => {
  const ids = (await accessibleCases(currentUser(req))).map((c) => c.c.id);
  if (ids.length === 0) {
    res.json([]);
    return;
  }
  const txns = await db
    .select({ fy: transactionsTable.financialYear, credit: transactionsTable.credit, debit: transactionsTable.debit })
    .from(transactionsTable)
    .where(inArray(transactionsTable.caseId, ids));
  const m = new Map<string, { credits: number; debits: number; count: number }>();
  for (const t of txns) {
    const g = m.get(t.fy) ?? { credits: 0, debits: 0, count: 0 };
    g.credits += t.credit;
    g.debits += t.debit;
    g.count++;
    m.set(t.fy, g);
  }
  res.json(
    [...m.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([financialYear, g]) => ({ financialYear, credits: round2(g.credits), debits: round2(g.debits), count: g.count })),
  );
});

router.get("/dashboard/activity", async (req, res): Promise<void> => {
  const user = currentUser(req);
  const ids = (await accessibleCases(user)).map((c) => c.c.id);
  const where = ids.length ? or(inArray(auditLogsTable.caseId, ids), eq(auditLogsTable.userId, user.id)) : eq(auditLogsTable.userId, user.id);
  const rows = await db.select().from(auditLogsTable).where(where).orderBy(desc(auditLogsTable.createdAt)).limit(25);
  res.json(rows.map(({ userId: _u, ...r }) => r));
});

router.get("/dashboard/deadlines", async (req, res): Promise<void> => {
  const cases = await accessibleCases(currentUser(req));
  const ids = cases.map((c) => c.c.id);
  const today = new Date().toISOString().slice(0, 10);
  const titles = new Map(cases.map((c) => [c.c.id, c.c.title]));
  const out: { kind: string; title: string; dueDate: string; caseId: number; caseTitle: string; queryId: number | null }[] = [];
  for (const c of cases) {
    if (c.c.submissionDeadline && c.c.submissionDeadline >= today && c.c.status !== "closed") {
      out.push({ kind: "case_submission", title: `Submission due: ${c.c.title}`, dueDate: c.c.submissionDeadline, caseId: c.c.id, caseTitle: c.c.title, queryId: null });
    }
  }
  if (ids.length) {
    const qs = await db
      .select()
      .from(investigationQueriesTable)
      .where(and(inArray(investigationQueriesTable.caseId, ids), isNotNull(investigationQueriesTable.responseDeadline), gte(investigationQueriesTable.responseDeadline, today)));
    for (const q of qs) {
      if (CLOSED_QUERY.has(q.status) || q.status === "submitted") continue;
      out.push({ kind: "query_response", title: `Q${q.questionNumber}: ${q.subject}`, dueDate: q.responseDeadline!, caseId: q.caseId, caseTitle: titles.get(q.caseId) ?? "", queryId: q.id });
    }
  }
  out.sort((a, b) => a.dueDate.localeCompare(b.dueDate));
  res.json(out.slice(0, 20));
});

export default router;
