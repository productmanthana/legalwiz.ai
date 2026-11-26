import { Router, type IRouter } from "express";
import { and, asc, desc, eq, inArray, or } from "drizzle-orm";
import {
  db,
  investigationQueriesTable,
  queryResponsesTable,
  assessmentsTable,
  transactionsTable,
  auditLogsTable,
  assetsTable,
  documentsTable,
  legalReferencesTable,
  caseLegalLinksTable,
} from "@workspace/db";
import {
  CreateQueryBody,
  UpdateQueryBody,
  CreateQueryResponseBody,
  UpdateQueryResponseBody,
  CreateAssessmentBody,
} from "@workspace/api-zod";
import { intParam, loadCase, type Need } from "../lib/access";
import { audit, diff } from "../lib/audit";
import { responseCounts, serializeTxns } from "../lib/serialize";
import { aiConfigured, completeJson, GUARDRAILS } from "../lib/ai";

const router: IRouter = Router();

type QueryRow = typeof investigationQueriesTable.$inferSelect;

async function serializeQueries(rows: QueryRow[]) {
  const counts = await responseCounts(rows.map((r) => r.id));
  return rows.map((q) => ({ ...q, responseCount: counts.get(q.id) ?? 0 }));
}

async function loadQuery(req: Parameters<typeof loadCase>[0], res: Parameters<typeof loadCase>[1], need: Need, id = intParam(req, "queryId")) {
  const [q] = await db.select().from(investigationQueriesTable).where(eq(investigationQueriesTable.id, id));
  if (!q) {
    res.status(404).json({ error: "Query not found" });
    return null;
  }
  const ctx = await loadCase(req, res, q.caseId, need);
  if (!ctx) return null;
  return { q, ctx };
}

router.get("/cases/:caseId/queries", async (req, res): Promise<void> => {
  const ctx = await loadCase(req, res, intParam(req, "caseId"));
  if (!ctx) return;
  const rows = await db.select().from(investigationQueriesTable).where(eq(investigationQueriesTable.caseId, ctx.c.id)).orderBy(asc(investigationQueriesTable.id));
  res.json(await serializeQueries(rows));
});

router.post("/cases/:caseId/queries", async (req, res): Promise<void> => {
  // Queries are raised by investigators, or recorded by the case owner/editor from a received notice.
  const ctx = await loadCase(req, res, intParam(req, "caseId"));
  if (!ctx) return;
  if (ctx.role === "reviewer") {
    res.status(403).json({ error: "Reviewers cannot raise or record queries" });
    return;
  }
  const parsed = CreateQueryBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const existing = await db.select({ id: investigationQueriesTable.id }).from(investigationQueriesTable).where(eq(investigationQueriesTable.caseId, ctx.c.id));
  let questionNumber = parsed.data.questionNumber?.trim();
  if (!questionNumber) {
    if (parsed.data.parentQueryId) {
      const [parent] = await db.select().from(investigationQueriesTable).where(eq(investigationQueriesTable.id, parsed.data.parentQueryId));
      if (!parent || parent.caseId !== ctx.c.id) {
        res.status(400).json({ error: "Parent query not found in this case" });
        return;
      }
      const siblings = await db.select({ id: investigationQueriesTable.id }).from(investigationQueriesTable).where(eq(investigationQueriesTable.parentQueryId, parent.id));
      questionNumber = `${parent.questionNumber}.${siblings.length + 1}`;
    } else {
      questionNumber = String(existing.length + 1);
    }
  }
  const values = {
    ...parsed.data,
    questionNumber,
    caseId: ctx.c.id,
    raisedBy: `${ctx.user.displayName} (${ctx.role === "investigator" ? "investigating officer" : "recorded by " + ctx.role})`,
  };
  const [q] = await db.insert(investigationQueriesTable).values(values).returning();
  if (parsed.data.parentQueryId) {
    await db.update(investigationQueriesTable).set({ status: "clarification_required" }).where(eq(investigationQueriesTable.id, parsed.data.parentQueryId));
  }
  await audit(req, { caseId: ctx.c.id, caseTitle: ctx.c.title, action: parsed.data.parentQueryId ? "query.follow_up_raised" : "query.created", entityType: "query", entityId: q!.id, summary: `Q${questionNumber}: ${q!.subject}`, next: values });
  res.status(201).json((await serializeQueries([q!]))[0]);
});

router.get("/queries/:queryId", async (req, res): Promise<void> => {
  const r = await loadQuery(req, res, "read");
  if (!r) return;
  const { q } = r;
  const [responses, assessments, followUps, txns, history] = await Promise.all([
    db.select().from(queryResponsesTable).where(eq(queryResponsesTable.queryId, q.id)).orderBy(asc(queryResponsesTable.version)),
    db.select().from(assessmentsTable).where(eq(assessmentsTable.queryId, q.id)).orderBy(asc(assessmentsTable.createdAt)),
    db.select().from(investigationQueriesTable).where(eq(investigationQueriesTable.parentQueryId, q.id)).orderBy(asc(investigationQueriesTable.id)),
    q.relatedTransactionIds.length ? db.select().from(transactionsTable).where(inArray(transactionsTable.id, q.relatedTransactionIds)) : Promise.resolve([]),
    db
      .select()
      .from(auditLogsTable)
      .where(
        or(
          and(eq(auditLogsTable.entityType, "query"), eq(auditLogsTable.entityId, q.id)),
          and(eq(auditLogsTable.entityType, "query_response"), eq(auditLogsTable.caseId, q.caseId)),
          and(eq(auditLogsTable.entityType, "assessment"), eq(auditLogsTable.caseId, q.caseId)),
        ),
      )
      .orderBy(desc(auditLogsTable.createdAt))
      .limit(200),
  ]);
  const responseIds = new Set(responses.map((x) => x.id));
  const assessmentIds = new Set(assessments.map((x) => x.id));
  const relevantHistory = history.filter(
    (h) => h.entityType === "query" || (h.entityType === "query_response" && h.entityId != null && responseIds.has(h.entityId)) || (h.entityType === "assessment" && h.entityId != null && assessmentIds.has(h.entityId)),
  );
  res.json({
    ...(await serializeQueries([q]))[0],
    responses,
    assessments,
    followUps: await serializeQueries(followUps),
    relatedTransactions: await serializeTxns(q.caseId, txns.filter((t) => t.caseId === q.caseId)),
    history: relevantHistory.map(({ userId: _u, ...h }) => h),
  });
});

router.patch("/queries/:queryId", async (req, res): Promise<void> => {
  const r = await loadQuery(req, res, "read");
  if (!r) return;
  const { q, ctx } = r;
  if (ctx.role === "reviewer") {
    res.status(403).json({ error: "Reviewers cannot change queries" });
    return;
  }
  const parsed = UpdateQueryBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  if (parsed.data.status && ["reviewed", "closed"].includes(parsed.data.status) && ctx.role !== "investigator" && ctx.role !== "owner") {
    res.status(403).json({ error: "Only the investigating officer or case owner can mark a query reviewed or closed" });
    return;
  }
  const [u] = await db.update(investigationQueriesTable).set(parsed.data).where(eq(investigationQueriesTable.id, q.id)).returning();
  const d = diff(q as unknown as Record<string, unknown>, parsed.data);
  await audit(req, { caseId: ctx.c.id, caseTitle: ctx.c.title, action: "query.updated", entityType: "query", entityId: q.id, summary: `Q${q.questionNumber}: updated ${Object.keys(d.next).join(", ") || "no fields"}`, previous: d.previous, next: d.next });
  res.json((await serializeQueries([u!]))[0]);
});

router.post("/queries/:queryId/responses", async (req, res): Promise<void> => {
  const r = await loadQuery(req, res, "edit");
  if (!r) return;
  const { q, ctx } = r;
  const parsed = CreateQueryResponseBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const prev = await db.select({ v: queryResponsesTable.version }).from(queryResponsesTable).where(eq(queryResponsesTable.queryId, q.id));
  const version = prev.reduce((m, x) => Math.max(m, x.v), 0) + 1;
  const [resp] = await db
    .insert(queryResponsesTable)
    .values({ queryId: q.id, version, body: parsed.data.body, isAiDraft: parsed.data.isAiDraft ?? false, documentIds: parsed.data.documentIds ?? [], authorName: ctx.user.displayName, status: "draft" })
    .returning();
  if (q.status === "open") await db.update(investigationQueriesTable).set({ status: "draft" }).where(eq(investigationQueriesTable.id, q.id));
  await audit(req, { caseId: ctx.c.id, caseTitle: ctx.c.title, action: "query_response.drafted", entityType: "query_response", entityId: resp!.id, summary: `Q${q.questionNumber}: response version ${version} saved as draft${resp!.isAiDraft ? " (originated from AI draft)" : ""}`, next: { body: resp!.body } });
  res.status(201).json(resp);
});

router.patch("/responses/:responseId", async (req, res): Promise<void> => {
  const [resp] = await db.select().from(queryResponsesTable).where(eq(queryResponsesTable.id, intParam(req, "responseId")));
  if (!resp) {
    res.status(404).json({ error: "Response not found" });
    return;
  }
  const parsed = UpdateQueryResponseBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const action = parsed.data.action;
  const need: Need = action === "mark_under_review" ? "investigate" : "edit";
  const r = await loadQuery(req, res, need, resp.queryId);
  if (!r) return;
  const { q, ctx } = r;
  const patch: Partial<typeof queryResponsesTable.$inferInsert> = {};
  const contentChanged = (parsed.data.body !== undefined && parsed.data.body !== resp.body) || parsed.data.documentIds !== undefined;
  if (contentChanged) {
    if (resp.status !== "draft") {
      res.status(409).json({ error: "Submitted responses cannot be edited. Add a new response version instead." });
      return;
    }
    if (parsed.data.body !== undefined) patch.body = parsed.data.body;
    if (parsed.data.documentIds !== undefined) patch.documentIds = parsed.data.documentIds;
    // Any content edit invalidates a previous approval.
    patch.approvedAt = null;
    patch.approvedBy = null;
  }
  let summary = `Q${q.questionNumber} v${resp.version}: edited draft`;
  let queryStatus: string | null = null;
  if (action === "approve") {
    if (resp.status !== "draft") {
      res.status(409).json({ error: "Only drafts can be approved" });
      return;
    }
    patch.approvedAt = new Date();
    patch.approvedBy = `${ctx.user.displayName} (${ctx.role})`;
    summary = `Q${q.questionNumber} v${resp.version}: content approved by ${ctx.user.displayName}`;
  } else if (action === "submit") {
    const approved = contentChanged ? false : !!resp.approvedAt;
    if (!approved) {
      res.status(409).json({ error: "This response must be approved before it can be submitted." });
      return;
    }
    patch.status = "submitted";
    patch.submittedAt = new Date();
    queryStatus = "submitted";
    summary = `Q${q.questionNumber} v${resp.version}: submitted to the investigating authority`;
  } else if (action === "mark_under_review") {
    if (resp.status !== "submitted") {
      res.status(409).json({ error: "Only submitted responses can be marked under review" });
      return;
    }
    patch.status = "under_review";
    queryStatus = "under_review";
    summary = `Q${q.questionNumber} v${resp.version}: marked under review`;
  }
  const [u] = Object.keys(patch).length ? await db.update(queryResponsesTable).set(patch).where(eq(queryResponsesTable.id, resp.id)).returning() : [resp];
  if (queryStatus) await db.update(investigationQueriesTable).set({ status: queryStatus }).where(eq(investigationQueriesTable.id, q.id));
  await audit(req, {
    caseId: ctx.c.id,
    caseTitle: ctx.c.title,
    action: action ? `query_response.${action}` : "query_response.edited",
    entityType: "query_response",
    entityId: resp.id,
    summary,
    previous: contentChanged ? { body: resp.body } : { status: resp.status },
    next: contentChanged ? { body: u!.body } : { status: u!.status },
  });
  res.json(u);
});

router.post("/queries/:queryId/assessments", async (req, res): Promise<void> => {
  const r = await loadQuery(req, res, "investigate");
  if (!r) return;
  const { q, ctx } = r;
  const parsed = CreateAssessmentBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  if (parsed.data.responseId) {
    const [resp] = await db.select().from(queryResponsesTable).where(eq(queryResponsesTable.id, parsed.data.responseId));
    if (!resp || resp.queryId !== q.id) {
      res.status(400).json({ error: "Response does not belong to this query" });
      return;
    }
    const respStatus = parsed.data.outcome === "accepted" ? "reviewed" : parsed.data.outcome === "clarification_required" ? "clarification_required" : "partially_addressed";
    await db.update(queryResponsesTable).set({ status: respStatus }).where(eq(queryResponsesTable.id, resp.id));
  }
  const [a] = await db.insert(assessmentsTable).values({ ...parsed.data, queryId: q.id, assessorName: `${ctx.user.displayName} (${ctx.role})` }).returning();
  const queryStatus = parsed.data.outcome === "accepted" ? "reviewed" : parsed.data.outcome === "clarification_required" ? "clarification_required" : "partially_addressed";
  await db.update(investigationQueriesTable).set({ status: queryStatus }).where(eq(investigationQueriesTable.id, q.id));
  await audit(req, { caseId: ctx.c.id, caseTitle: ctx.c.title, action: "assessment.recorded", entityType: "assessment", entityId: a!.id, summary: `Q${q.questionNumber}: assessment recorded as ${parsed.data.outcome.replace(/_/g, " ")}`, next: parsed.data });
  res.status(201).json(a);
});

router.post("/queries/:queryId/draft-response", async (req, res): Promise<void> => {
  const r = await loadQuery(req, res, "edit");
  if (!r) return;
  const { q, ctx } = r;
  if (!aiConfigured()) {
    res.json({ available: false, body: "", citations: [], gaps: [], message: "The AI drafting service is not configured. Write the response manually." });
    return;
  }
  const [txns, assets, docs, links] = await Promise.all([
    q.relatedTransactionIds.length ? db.select().from(transactionsTable).where(inArray(transactionsTable.id, q.relatedTransactionIds)) : Promise.resolve([]),
    q.relatedAssetIds.length ? db.select().from(assetsTable).where(inArray(assetsTable.id, q.relatedAssetIds)) : Promise.resolve([]),
    db.select().from(documentsTable).where(and(eq(documentsTable.caseId, q.caseId), eq(documentsTable.isArchived, false))),
    db
      .select({ ref: legalReferencesTable, note: caseLegalLinksTable.relevanceNote })
      .from(caseLegalLinksTable)
      .innerJoin(legalReferencesTable, eq(legalReferencesTable.id, caseLegalLinksTable.legalReferenceId))
      .where(eq(caseLegalLinksTable.caseId, q.caseId)),
  ]);
  const verified = links.filter((l) => l.ref.verificationStatus === "verified");
  const context = {
    query: { number: q.questionNumber, subject: q.subject, description: q.description, topic: q.topic, financialYear: q.financialYear },
    transactions: txns.filter((t) => t.caseId === q.caseId).map((t) => ({ id: t.id, date: t.txnDate, description: t.description, debit: t.debit, credit: t.credit, category: t.category ?? "not categorised", explanation: t.explanation ?? null, linkedDocumentIds: t.documentIds })),
    assets: assets.filter((a) => a.caseId === q.caseId).map((a) => ({ id: a.id, description: a.description, acquisitionDate: a.acquisitionDate, cost: a.purchasePrice, sourceOfFunds: a.sourceOfFunds, documentIds: a.documentIds })),
    documents: docs.map((d) => ({ id: d.id, name: d.name, category: d.category, financialYear: d.financialYear })),
    verifiedLegalReferences: verified.map((l) => ({ id: l.ref.id, title: l.ref.title, citation: l.ref.citation, provision: l.ref.provision, principle: l.ref.principle, relevanceNote: l.note })),
  };
  try {
    const out = await completeJson<{ body?: string; citations?: string[]; gaps?: string[] }>(
      `${GUARDRAILS}
You draft a factual response to an investigation query for review by the advocate or CA. The draft will be edited and must be approved by a person before submission.
Write in formal, neutral English addressed to the investigating officer. Refer to transactions by date and amount (Rs. with Indian grouping) and to documents by name. Do not argue the law beyond the verified legal references provided; if none are provided, do not cite any law.
Where records are insufficient, write "[To be confirmed: ...]" placeholders rather than inventing facts.
Return JSON: {"body": string, "citations": string[] (only titles/citations of the verified legal references you used), "gaps": string[] (information or documents still needed)}.`,
      JSON.stringify(context),
    );
    const allowed = new Set(verified.flatMap((l) => [l.ref.title, l.ref.citation].filter(Boolean) as string[]));
    const citations = (out.citations ?? []).filter((c) => [...allowed].some((a) => c.includes(a) || a.includes(c)));
    const dropped = (out.citations ?? []).length - citations.length;
    const gaps = [...(out.gaps ?? [])];
    if (dropped > 0) gaps.push(`${dropped} citation(s) proposed by the AI were removed because they are not verified references linked to this case.`);
    if (txns.length === 0 && assets.length === 0) gaps.push("No transactions or assets are linked to this query; link them for a more specific draft.");
    await audit(req, { caseId: ctx.c.id, caseTitle: ctx.c.title, action: "query.ai_draft_generated", entityType: "query", entityId: q.id, summary: `Q${q.questionNumber}: AI draft generated (not saved until a user saves it)` });
    res.json({ available: true, body: out.body ?? "", citations, gaps, message: "AI suggestion. Review, edit and approve before submitting." });
  } catch (err) {
    req.log.error({ err }, "AI draft generation failed");
    res.json({ available: false, body: "", citations: [], gaps: [], message: "The AI drafting service did not respond. Try again later or write the response manually." });
  }
});

export default router;
