import { Router, type IRouter } from "express";
import { and, asc, eq } from "drizzle-orm";
import {
  db,
  assistantMessagesTable,
  transactionsTable,
  assetsTable,
  documentsTable,
  ledgerEntriesTable,
  legalReferencesTable,
  caseLegalLinksTable,
  familyMembersTable,
  liabilitiesTable,
} from "@workspace/db";
import { AskAssistantBody } from "@workspace/api-zod";
import { intParam, loadCase } from "../lib/access";
import { audit } from "../lib/audit";
import { aiConfigured, completeJson, GUARDRAILS } from "../lib/ai";
import { blindSpots, daCalculation } from "../lib/schedules";

const router: IRouter = Router();

type Citation = { kind: "transaction" | "document" | "asset" | "legal_reference" | "ledger_entry"; id: number; label: string };

router.get("/cases/:caseId/assistant/messages", async (req, res): Promise<void> => {
  const ctx = await loadCase(req, res, intParam(req, "caseId"));
  if (!ctx) return;
  const rows = await db
    .select()
    .from(assistantMessagesTable)
    .where(and(eq(assistantMessagesTable.caseId, ctx.c.id), eq(assistantMessagesTable.userId, ctx.user.id)))
    .orderBy(asc(assistantMessagesTable.id));
  res.json(rows.map(({ userId: _u, ...m }) => m));
});

router.post("/cases/:caseId/assistant/messages", async (req, res): Promise<void> => {
  const ctx = await loadCase(req, res, intParam(req, "caseId"));
  if (!ctx) return;
  const parsed = AskAssistantBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const caseId = ctx.c.id;
  await db.insert(assistantMessagesTable).values({ caseId, userId: ctx.user.id, role: "user", content: parsed.data.message });

  const save = async (content: string, citations: Citation[], available: boolean) => {
    const [m] = await db.insert(assistantMessagesTable).values({ caseId, userId: ctx.user.id, role: "assistant", content, citations, available }).returning();
    const { userId: _u, ...rest } = m!;
    return rest;
  };

  if (!aiConfigured()) {
    res.json(await save("The AI assistant is not configured for this workspace, so no answer can be generated. All schedules and calculations remain available.", [], false));
    return;
  }

  const [txns, assets, docs, entries, family, liabilities, links] = await Promise.all([
    db.select().from(transactionsTable).where(eq(transactionsTable.caseId, caseId)),
    db.select().from(assetsTable).where(eq(assetsTable.caseId, caseId)),
    db.select().from(documentsTable).where(and(eq(documentsTable.caseId, caseId), eq(documentsTable.isArchived, false))),
    db.select().from(ledgerEntriesTable).where(eq(ledgerEntriesTable.caseId, caseId)),
    db.select().from(familyMembersTable).where(eq(familyMembersTable.caseId, caseId)),
    db.select().from(liabilitiesTable).where(eq(liabilitiesTable.caseId, caseId)),
    db
      .select({ ref: legalReferencesTable })
      .from(caseLegalLinksTable)
      .innerJoin(legalReferencesTable, eq(legalReferencesTable.id, caseLegalLinksTable.legalReferenceId))
      .where(eq(caseLegalLinksTable.caseId, caseId)),
  ]);
  const [da, spots] = await Promise.all([daCalculation(ctx.c, false), blindSpots(caseId)]);
  const history = await db
    .select()
    .from(assistantMessagesTable)
    .where(and(eq(assistantMessagesTable.caseId, caseId), eq(assistantMessagesTable.userId, ctx.user.id)))
    .orderBy(asc(assistantMessagesTable.id));

  // Keep the prompt bounded: largest transactions plus a sample of the rest.
  const txnSample = [...txns].sort((a, b) => Math.max(b.credit, b.debit) - Math.max(a.credit, a.debit)).slice(0, 250);
  const context = {
    case: { title: ctx.c.title, type: ctx.c.caseType, subject: ctx.c.subjectName, periodStart: ctx.c.periodStart, periodEnd: ctx.c.periodEnd, isDemo: ctx.c.isDemo },
    totals: { transactions: txns.length, shownTransactions: txnSample.length },
    transactions: txnSample.map((t) => ({ id: t.id, date: t.txnDate, desc: t.description.slice(0, 90), dr: t.debit, cr: t.credit, category: t.category, suggested: t.suggestedCategory, explanation: t.explanation, docs: t.documentIds, edited: t.isEdited })),
    assets: assets.map((a) => ({ id: a.id, description: a.description, type: a.assetType, acquired: a.acquisitionDate, cost: a.purchasePrice, ownership: a.ownership, sourceOfFunds: a.sourceOfFunds })),
    liabilities: liabilities.map((l) => ({ lender: l.lender, type: l.liabilityType, principal: l.principalAmount, sanctioned: l.sanctionDate })),
    family: family.map((f) => ({ name: f.name, relationship: f.relationship, independentIncome: f.hasIndependentIncome, occupation: f.occupation })),
    ledgerEntries: entries.map((e) => ({ id: e.id, type: e.entryType, category: e.category, amount: e.amount, date: e.entryDate, status: e.verificationStatus })),
    documents: docs.map((d) => ({ id: d.id, name: d.name, category: d.category, fy: d.financialYear })),
    daWorking: { components: da.components.map((c) => ({ code: c.code, amount: c.amount })), disproportion: da.disproportion, percent: da.disproportionPercent, missing: da.missingInformation },
    blindSpots: spots.map((s) => ({ title: s.title, severity: s.severity, status: s.reviewStatus })),
    legalReferences: links.map((l) => ({ id: l.ref.id, title: l.ref.title, citation: l.ref.citation, verificationStatus: l.ref.verificationStatus, principle: l.ref.principle })),
  };
  const convo = history.slice(-10).map((m) => `${m.role.toUpperCase()}: ${m.content}`).join("\n\n");

  try {
    const out = await completeJson<{ answer?: string; citations?: { kind?: string; id?: number }[] }>(
      `${GUARDRAILS}
You answer questions about one case using the JSON case data supplied. Format the answer as concise Markdown. Prefix each key point with a bold label: **Verified fact**, **User-provided**, **AI suggestion**, or **Missing information**.
Return JSON: {"answer": string, "citations": [{"kind": "transaction"|"document"|"asset"|"legal_reference"|"ledger_entry", "id": number}]} citing the records you relied on by id.`,
      `CASE DATA:\n${JSON.stringify(context)}\n\nCONVERSATION:\n${convo}`,
    );
    // Validate every citation against the case; drop anything the model invented.
    const lookups: Record<Citation["kind"], Map<number, string>> = {
      transaction: new Map(txns.map((t) => [t.id, `${t.txnDate} ${t.description.slice(0, 50)} (${t.credit > 0 ? "Cr " + t.credit : "Dr " + t.debit})`])),
      document: new Map(docs.map((d) => [d.id, d.name])),
      asset: new Map(assets.map((a) => [a.id, a.description])),
      legal_reference: new Map(links.map((l) => [l.ref.id, `${l.ref.title} [${l.ref.verificationStatus}]`])),
      ledger_entry: new Map(entries.map((e) => [e.id, `${e.category} ${e.amount} (${e.entryDate})`])),
    };
    const citations: Citation[] = [];
    let dropped = 0;
    for (const c of out.citations ?? []) {
      const kind = c.kind as Citation["kind"];
      const label = lookups[kind]?.get(Number(c.id));
      if (label && !citations.some((x) => x.kind === kind && x.id === c.id)) citations.push({ kind, id: Number(c.id), label });
      else if (!label) dropped++;
    }
    let answer = out.answer?.trim() || "No answer was produced.";
    if (dropped > 0) answer += `\n\n_${dropped} citation(s) were removed because they did not match records in this case._`;
    const msg = await save(answer, citations, true);
    await audit(req, { caseId, caseTitle: ctx.c.title, action: "assistant.asked", entityType: "assistant_message", entityId: msg.id, summary: `Asked the AI assistant: ${parsed.data.message.slice(0, 120)}` });
    res.json(msg);
  } catch (err) {
    req.log.error({ err }, "AI assistant failed");
    res.json(await save("The AI assistant did not respond. No answer was generated; please try again later.", [], false));
  }
});

export default router;
