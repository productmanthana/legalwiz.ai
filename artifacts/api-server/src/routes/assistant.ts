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
import { aiConfigured, completeJsonWithTools, GUARDRAILS } from "../lib/ai";
import { assistantTools } from "../lib/assistantTools";
import { blindSpots, daCalculation } from "../lib/schedules";
import { weaviateConfigured } from "../lib/weaviate";
import { documentPassages } from "../lib/assistantContext";
import { answerReport } from "../lib/assistantExport";
import { renderDocx, renderPdf, renderXlsx } from "../lib/reports";

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
  // Relevant passages from this case's indexed documents (Weaviate tenant = this case only).
  const liveDocIds = new Set(docs.map((d) => d.id));
  const docText = weaviateConfigured()
    ? await documentPassages(caseId, parsed.data.message, liveDocIds).catch((err) => {
        req.log.error({ err }, "Document search failed");
        return { complete: false, pages: [] };
      })
    : { complete: false, pages: [] };
  const passages = docText.pages;
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
    documentTextIsComplete: docText.complete,
    documentPassages: passages.map((p) => ({ documentId: p.documentId, document: p.documentName, page: p.pageNumber, readBy: p.method === "text" ? "text extraction" : "vision model", text: p.content })),
    daWorking: { components: da.components.map((c) => ({ code: c.code, amount: c.amount })), disproportion: da.disproportion, percent: da.disproportionPercent, missing: da.missingInformation },
    blindSpots: spots.map((s) => ({ title: s.title, severity: s.severity, status: s.reviewStatus })),
    legalReferences: links.map((l) => ({ id: l.ref.id, title: l.ref.title, citation: l.ref.citation, verificationStatus: l.ref.verificationStatus, principle: l.ref.principle })),
  };
  const tools = assistantTools(passages);
  const convo = history.slice(-10).map((m) => `${m.role.toUpperCase()}: ${m.content}`).join("\n\n");

  try {
    const out = await completeJsonWithTools<{ answer?: string; citations?: { kind?: string; id?: number; page?: number }[] }>(
      `${GUARDRAILS}
You answer questions about one case using the JSON case data supplied. Format the answer as concise Markdown. Prefix each key point with a bold label: **Verified fact**, **User-provided**, **AI suggestion**, or **Missing information**.
documentPassages hold text of the case's uploaded documents, one entry per page. When documentTextIsComplete is true they are the COMPLETE text of every page of every document: answer from all of them, and for totals or lists go through every page and every matching entry. When it is false they are only the best-matching excerpts: say so under **Missing information**.
When the question asks for data, totals, lists or schedules, present the itemised entries as a Markdown table (with date, document, page, description and amount columns where available) followed by the total row.
Always end with a **Missing information** section listing what is missing, illegible or uncertain (unreadable pages, gaps in periods, conflicting figures) and what the user should provide; write "None identified" if nothing is missing.
TOTALS MUST COME FROM THE TOOLS, never from your own arithmetic. Scanned statements carry a table "| # | Date | Ref | Particulars | Debit | Credit | Balance | Check |" whose rows were checked against the printed running balance. To total a kind of entry (e.g. pension), do not rely on one keyword: first call sum_statement_rows with the column and date range but no keywords to get every candidate row, classify each row yourself from its particulars (OCR spellings vary, e.g. "PEN", "Fension", "pensicn", "DA arrear", "DR ARREAR PAYMENT"; unlabelled credits are not counted), then call it again with rowRefs listing exactly the rows you chose and report that total. Consider related debits too (e.g. a recovery of excess pension) and say how you treated them. For any other figures (schedules, tables in text, ledger data) pass the itemised amounts to add_numbers. State the row count and the tool's total; list rows marked "check original" under **Missing information**. Where two documents cover the same period (e.g. a pension schedule and the bank credits), do not double count: say which source each period is taken from and reconcile the overlap.
Quote them with the document name and page (e.g. "Sale deed, p. 4"). Passages "read by vision model" were transcribed from scanned pages or images and must be checked against the original.
Return JSON: {"answer": string, "citations": [{"kind": "transaction"|"document"|"asset"|"legal_reference"|"ledger_entry", "id": number, "page"?: number}]} citing the records you relied on by id (for a document passage use its documentId and page).`,
      `CASE DATA:\n${JSON.stringify(context)}\n\nCONVERSATION:\n${convo}`,
      tools,
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
      const base = lookups[kind]?.get(Number(c.id));
      const page = kind === "document" && passages.some((p) => p.documentId === Number(c.id) && p.pageNumber === Number(c.page)) ? Number(c.page) : null;
      const label = base && page ? `${base}, p. ${page}` : base;
      if (label && !citations.some((x) => x.kind === kind && x.id === Number(c.id) && x.label === label)) citations.push({ kind, id: Number(c.id), label });
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

const EXPORT_MIME: Record<string, string> = {
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  pdf: "application/pdf",
};

/** Downloads one assistant answer as Excel, Word or PDF. */
router.get("/cases/:caseId/assistant/messages/:messageId/export", async (req, res): Promise<void> => {
  const ctx = await loadCase(req, res, intParam(req, "caseId"));
  if (!ctx) return;
  const format = String(req.query.format ?? "");
  if (!EXPORT_MIME[format]) {
    res.status(400).json({ error: "format must be xlsx, docx or pdf" });
    return;
  }
  const rows = await db
    .select()
    .from(assistantMessagesTable)
    .where(and(eq(assistantMessagesTable.caseId, ctx.c.id), eq(assistantMessagesTable.userId, ctx.user.id)))
    .orderBy(asc(assistantMessagesTable.id));
  const idx = rows.findIndex((m) => m.id === intParam(req, "messageId") && m.role === "assistant");
  if (idx < 0) {
    res.status(404).json({ error: "Answer not found" });
    return;
  }
  const question = rows.slice(0, idx).reverse().find((m) => m.role === "user")?.content ?? "";
  const model = answerReport(ctx.c.title, question, rows[idx]!, ctx.user.displayName);
  const buf = format === "xlsx" ? await renderXlsx(model) : format === "pdf" ? await renderPdf(model) : await renderDocx(model);
  await audit(req, { caseId: ctx.c.id, caseTitle: ctx.c.title, action: "assistant.exported", entityType: "assistant_message", entityId: rows[idx]!.id, summary: `Exported an AI assistant answer as ${format.toUpperCase()}` });
  res.setHeader("Content-Type", EXPORT_MIME[format]!);
  res.setHeader("Content-Disposition", `attachment; filename="${`${ctx.c.title}-assistant-${rows[idx]!.id}`.replace(/[^A-Za-z0-9-_]+/g, "_").slice(0, 80)}.${format}"`);
  res.send(buf);
});

export default router;
