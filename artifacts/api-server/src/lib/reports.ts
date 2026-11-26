import ExcelJS from "exceljs";
import PDFDocument from "pdfkit";
import {
  Document as DocxDocument,
  Packer,
  Paragraph,
  Table,
  TableRow,
  TableCell,
  TextRun,
  HeadingLevel,
  WidthType,
  AlignmentType,
} from "docx";
import { asc, desc, eq, inArray } from "drizzle-orm";
import {
  db,
  transactionsTable,
  assetsTable,
  liabilitiesTable,
  investigationQueriesTable,
  queryResponsesTable,
  assessmentsTable,
  transactionMatchesTable,
  auditLogsTable,
  type CaseRow,
} from "@workspace/db";
import { accountMap } from "./serialize";
import { blindSpots, daCalculation, incomeExpenditure } from "./schedules";
import { formatINR } from "./finance";

type Cell = string | number | null;
export type ReportTable = { columns: string[]; rows: Cell[][]; numeric?: number[] };
export type ReportSection = { heading: string; paragraphs?: string[]; table?: ReportTable };
export type ReportModel = { title: string; subtitle: string; sections: ReportSection[] };

export const DISCLAIMER =
  "Prepared with FINTRACE from records entered by the user. This is not an official government form and does not represent a finding of guilt, liability or the acceptability of any explanation. Figures depend on the categorisation approved by users and should be verified against source documents.";

export const REPORT_TYPES = [
  { key: "transaction_ledger", name: "Transaction ledger", description: "All bank transactions with category, review and reconciliation status." },
  { key: "income_expenditure", name: "Income and expenditure statement", description: "Year-wise income, receipts and expenditure from approved categories." },
  { key: "da_statement", name: "Disproportionate assets working", description: "A/B/C/D working for the check period with assumptions and missing information." },
  { key: "asset_schedule", name: "Asset and liability schedule", description: "Assets at cost with ownership and source of funds, and liabilities." },
  { key: "reconciliation_report", name: "Reconciliation report", description: "Approved, partial and pending matches between transactions." },
  { key: "query_response_compilation", name: "Query response compilation", description: "Each query with its responses, approval status and assessments." },
  { key: "blind_spots", name: "Blind spot review", description: "Issues likely to be raised, with review status." },
  { key: "audit_trail", name: "Audit trail", description: "Chronological record of actions taken on the case." },
].map((r) => ({ ...r, formats: ["xlsx", "pdf", "docx"] as const }));

const money = (n: number | null | undefined) => (n == null ? null : Math.round(n * 100) / 100);

export async function buildReport(c: CaseRow, type: string, generatedBy: string): Promise<ReportModel | null> {
  const subtitle = `${c.title}${c.referenceNumber ? ` (${c.referenceNumber})` : ""} — generated ${new Date().toISOString().slice(0, 16).replace("T", " ")} UTC by ${generatedBy}${c.isDemo ? " — DEMO CASE, FICTITIOUS DATA" : ""}`;
  const base = (title: string, sections: ReportSection[]): ReportModel => ({ title, subtitle, sections: [...sections, { heading: "Disclaimer", paragraphs: [DISCLAIMER] }] });

  switch (type) {
    case "transaction_ledger": {
      const accts = await accountMap(c.id);
      const txns = await db.select().from(transactionsTable).where(eq(transactionsTable.caseId, c.id)).orderBy(asc(transactionsTable.txnDate), asc(transactionsTable.id));
      return base("Transaction ledger", [
        {
          heading: `${txns.length} transactions`,
          paragraphs: ["Rows marked 'Edited' were corrected after import; the original imported values are preserved in the audit trail."],
          table: {
            columns: ["Date", "Account", "Description", "Debit", "Credit", "Balance", "FY", "Category", "Review", "Reconciliation", "Edited"],
            numeric: [3, 4, 5],
            rows: txns.map((t) => {
              const a = accts.get(t.bankAccountId);
              return [t.txnDate, a ? `${a.bankName} ${a.maskedAccountNumber}` : "", t.description, money(t.debit) || null, money(t.credit) || null, money(t.balance), t.financialYear, t.category ?? (t.suggestedCategory ? `(suggested: ${t.suggestedCategory})` : "uncategorised"), t.reviewStatus, t.reconciliationStatus, t.isEdited ? "Edited" : ""];
            }),
          },
        },
      ]);
    }
    case "income_expenditure": {
      const ie = await incomeExpenditure(c.id, "annual");
      return base("Income and expenditure statement", [
        { heading: "Basis of preparation", paragraphs: ie.notes },
        {
          heading: "Summary by financial year",
          table: { columns: ["Period", "Income", "Receipts", "Expenditure"], numeric: [1, 2, 3], rows: [...ie.periods.map((p) => [p.period, p.totalIncome, p.totalReceipts, p.totalExpenditure] as Cell[]), ["Total", ie.totals.income, ie.totals.receipts, ie.totals.expenditure]] },
        },
        {
          heading: "Detail",
          table: { columns: ["Period", "Section", "Category", "Amount", "Records"], numeric: [3, 4], rows: ie.periods.flatMap((p) => p.lines.map((l) => [p.period, l.section, l.category.replace(/_/g, " "), l.amount, l.sources.length] as Cell[])) },
        },
      ]);
    }
    case "da_statement": {
      const da = await daCalculation(c, false);
      return base("Disproportionate assets working", [
        {
          heading: "Check period and formula",
          paragraphs: [
            da.checkPeriodStart ? `Check period: ${da.checkPeriodStart} to ${da.checkPeriodEnd}${da.checkPeriodConfigured ? "" : " (case period used — no check period configured)"}` : "Check period not configured.",
            da.formula,
            `Template version ${da.templateVersion}. Scope: subject only (self and joint holdings).`,
          ],
        },
        {
          heading: "Working",
          table: {
            columns: ["Item", "Amount (Rs.)"],
            numeric: [1],
            rows: [
              ...da.components.map((x) => [`${x.code}. ${x.label}`, x.amount] as Cell[]),
              ["Assets acquired during the period (B - A)", da.assetsAcquired],
              ["Likely savings (C - D)", da.likelySavings],
              ["Excess of assets over savings: (B - A) - (C - D)", da.disproportion],
              ["Percentage of C", da.disproportionPercent == null ? "Not computable" : `${da.disproportionPercent.toFixed(2)}%`],
            ],
          },
        },
        ...da.components.map((x) => ({
          heading: `Component ${x.code}: ${x.label}`,
          table: { columns: ["Item", "Amount (Rs.)", "Basis"], numeric: [1], rows: x.lines.length ? x.lines.map((l) => [l.label, l.amount, l.basis] as Cell[]) : [["No items", 0, ""]] },
        })),
        { heading: "Assumptions", paragraphs: da.assumptions },
        { heading: "Missing information", paragraphs: da.missingInformation.length ? da.missingInformation : ["None identified."] },
        { heading: "Note", paragraphs: [da.disclaimer] },
      ]);
    }
    case "asset_schedule": {
      const [assets, liabilities] = await Promise.all([
        db.select().from(assetsTable).where(eq(assetsTable.caseId, c.id)).orderBy(asc(assetsTable.acquisitionDate)),
        db.select().from(liabilitiesTable).where(eq(liabilitiesTable.caseId, c.id)),
      ]);
      return base("Asset and liability schedule", [
        {
          heading: "Assets",
          table: {
            columns: ["Description", "Type", "Acquired", "Disposed", "Purchase price", "Registration", "Current valuation", "Ownership", "Share %", "Source of funds"],
            numeric: [4, 5, 6, 8],
            rows: assets.map((a) => [a.description, a.assetType.replace(/_/g, " "), a.acquisitionDate, a.disposalDate, money(a.purchasePrice), money(a.registrationCost), money(a.currentValuation), a.ownership, a.ownershipSharePercent, a.sourceOfFunds ?? "Not recorded"]),
          },
        },
        {
          heading: "Liabilities",
          table: {
            columns: ["Lender", "Type", "Borrower", "Sanctioned", "Principal", "Outstanding at start", "Outstanding at end", "Purpose"],
            numeric: [4, 5, 6],
            rows: liabilities.map((l) => [l.lender, l.liabilityType.replace(/_/g, " "), l.borrower, l.sanctionDate, money(l.principalAmount), money(l.outstandingAtStart), money(l.outstandingAtEnd), l.purpose]),
          },
        },
      ]);
    }
    case "reconciliation_report": {
      const matches = await db.select().from(transactionMatchesTable).where(eq(transactionMatchesTable.caseId, c.id)).orderBy(asc(transactionMatchesTable.status), desc(transactionMatchesTable.amount));
      const ids = [...new Set(matches.flatMap((m) => [...m.sourceIds, ...m.targetIds]))];
      const txns = ids.length ? await db.select().from(transactionsTable).where(inArray(transactionsTable.id, ids)) : [];
      const byId = new Map(txns.map((t) => [t.id, t]));
      const desc_ = (list: number[]) => list.map((i) => byId.get(i)).filter(Boolean).map((t) => `${t!.txnDate} ${t!.description.slice(0, 40)}`).join("; ");
      return base("Reconciliation report", [
        { heading: "Note", paragraphs: ["A match records that funds moved between the listed transactions. It does not establish the legal character of the funds."] },
        {
          heading: "Matches",
          table: { columns: ["Type", "Status", "Amount", "Gap (days)", "Confidence", "Source", "Target", "Review note"], numeric: [2, 3, 4], rows: matches.map((m) => [m.matchType.replace(/_/g, " "), m.status, money(m.amount), m.dateGapDays, m.confidence, desc_(m.sourceIds), desc_(m.targetIds), m.reviewNote]) },
        },
      ]);
    }
    case "query_response_compilation": {
      const queries = await db.select().from(investigationQueriesTable).where(eq(investigationQueriesTable.caseId, c.id)).orderBy(asc(investigationQueriesTable.id));
      const qIds = queries.map((q) => q.id);
      const [responses, assessments] = qIds.length
        ? await Promise.all([
            db.select().from(queryResponsesTable).where(inArray(queryResponsesTable.queryId, qIds)).orderBy(asc(queryResponsesTable.version)),
            db.select().from(assessmentsTable).where(inArray(assessmentsTable.queryId, qIds)),
          ])
        : [[], []];
      return base(
        "Query response compilation",
        queries.map((q) => {
          const rs = responses.filter((r) => r.queryId === q.id);
          const as = assessments.filter((a) => a.queryId === q.id);
          const latest = [...rs].reverse().find((r) => r.status !== "draft") ?? rs[rs.length - 1];
          return {
            heading: `Q${q.questionNumber}. ${q.subject}`,
            paragraphs: [
              `Question: ${q.description}`,
              `Status: ${q.status.replace(/_/g, " ")}${q.responseDeadline ? ` — response due ${q.responseDeadline}` : ""}`,
              latest
                ? `Response (v${latest.version}, ${latest.status}${latest.approvedBy ? `, approved by ${latest.approvedBy}` : ", not approved"}${latest.isAiDraft ? ", originated from AI draft" : ""}):\n${latest.body}`
                : "No response recorded.",
              ...as.map((a) => `Assessment (${a.outcome.replace(/_/g, " ")}) by ${a.assessorName ?? "unknown"}: ${a.reasons}`),
            ],
          };
        }),
      );
    }
    case "blind_spots": {
      const spots = await blindSpots(c.id);
      return base("Blind spot review", [
        { heading: "About", paragraphs: ["These are issues an investigating officer may raise, detected from the records. They are prompts for review, not findings."] },
        { heading: "Issues", table: { columns: ["Severity", "Issue", "Why it matters", "Suggested clarification", "Review status", "Note"], rows: spots.map((s) => [s.severity, s.title, s.whyItMatters, s.suggestedClarification, s.reviewStatus.replace(/_/g, " "), s.reviewNote]) } },
      ]);
    }
    case "audit_trail": {
      const logs = await db.select().from(auditLogsTable).where(eq(auditLogsTable.caseId, c.id)).orderBy(asc(auditLogsTable.createdAt));
      return base("Audit trail", [
        { heading: `${logs.length} recorded actions`, table: { columns: ["When (UTC)", "User", "Action", "Summary"], rows: logs.map((l) => [l.createdAt.toISOString().slice(0, 19).replace("T", " "), l.userName, l.action, l.summary]) } },
      ]);
    }
    default:
      return null;
  }
}

const fmtCell = (v: Cell, isNum: boolean) => (v == null ? "" : isNum && typeof v === "number" ? formatINR(v) : String(v));

export async function renderXlsx(m: ReportModel): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = "FINTRACE";
  const cover = wb.addWorksheet("Report");
  cover.addRow([m.title]).font = { bold: true, size: 14 };
  cover.addRow([m.subtitle]);
  cover.addRow([]);
  for (const s of m.sections) {
    if (s.table) continue;
    cover.addRow([s.heading]).font = { bold: true };
    for (const p of s.paragraphs ?? []) cover.addRow([p]);
    cover.addRow([]);
  }
  cover.getColumn(1).width = 120;
  let n = 0;
  for (const s of m.sections) {
    if (!s.table) continue;
    n++;
    const name = `${n} ${s.heading}`.replace(/[\\/?*[\]:]/g, " ").slice(0, 31);
    const ws = wb.addWorksheet(name);
    for (const p of s.paragraphs ?? []) ws.addRow([p]).font = { italic: true };
    const header = ws.addRow(s.table.columns);
    header.font = { bold: true };
    header.eachCell((cell) => {
      cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFE8EDF3" } };
    });
    for (const r of s.table.rows) ws.addRow(r);
    s.table.columns.forEach((col, i) => {
      const c = ws.getColumn(i + 1);
      c.width = Math.min(60, Math.max(12, col.length + 2));
      if (s.table!.numeric?.includes(i)) c.numFmt = "#,##,##0.00";
    });
    ws.addRow([]);
    ws.addRow(["Not an official government form."]).font = { italic: true, size: 9 };
  }
  return Buffer.from(await wb.xlsx.writeBuffer());
}

export function renderPdf(m: ReportModel): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: "A4", layout: "landscape", margin: 36, bufferPages: true });
    const chunks: Buffer[] = [];
    doc.on("data", (c: Buffer) => chunks.push(c));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);
    const width = doc.page.width - 72;
    doc.font("Helvetica-Bold").fontSize(16).text(m.title);
    doc.font("Helvetica").fontSize(9).fillColor("#555").text(m.subtitle).fillColor("#000");
    doc.moveDown();
    for (const s of m.sections) {
      doc.font("Helvetica-Bold").fontSize(11).text(s.heading);
      doc.moveDown(0.3);
      for (const p of s.paragraphs ?? []) doc.font("Helvetica").fontSize(9).text(p.replace(/₹/g, "Rs."), { width });
      if (s.table) {
        const cols = s.table.columns.length;
        const colW = width / cols;
        const drawRow = (cells: string[], bold: boolean) => {
          doc.font(bold ? "Helvetica-Bold" : "Helvetica").fontSize(7);
          const h = Math.max(...cells.map((c) => doc.heightOfString(c, { width: colW - 4 }))) + 4;
          if (doc.y + h > doc.page.height - 48) doc.addPage();
          const y = doc.y;
          cells.forEach((c, i) => {
            const isNum = s.table!.numeric?.includes(i) && !bold;
            doc.text(c, 36 + i * colW + 2, y + 2, { width: colW - 4, align: isNum ? "right" : "left" });
          });
          doc.moveTo(36, y + h).lineTo(36 + width, y + h).strokeColor("#ccc").lineWidth(0.5).stroke();
          doc.x = 36;
          doc.y = y + h;
        };
        drawRow(s.table.columns, true);
        for (const r of s.table.rows) drawRow(r.map((v, i) => fmtCell(v, !!s.table!.numeric?.includes(i))), false);
      }
      doc.moveDown();
    }
    const range = doc.bufferedPageRange();
    for (let i = range.start; i < range.start + range.count; i++) {
      doc.switchToPage(i);
      doc.font("Helvetica").fontSize(7).fillColor("#777").text(`FINTRACE — not an official government form — page ${i + 1} of ${range.count}`, 36, doc.page.height - 30, { width, align: "center", lineBreak: false });
    }
    doc.end();
  });
}

export async function renderDocx(m: ReportModel): Promise<Buffer> {
  const children: (Paragraph | Table)[] = [
    new Paragraph({ text: m.title, heading: HeadingLevel.TITLE }),
    new Paragraph({ children: [new TextRun({ text: m.subtitle, italics: true, size: 18 })] }),
  ];
  for (const s of m.sections) {
    children.push(new Paragraph({ text: s.heading, heading: HeadingLevel.HEADING_2 }));
    for (const p of s.paragraphs ?? []) for (const line of p.split("\n")) children.push(new Paragraph({ children: [new TextRun({ text: line, size: 20 })] }));
    if (s.table) {
      const mk = (cells: string[], bold: boolean) =>
        new TableRow({
          tableHeader: bold,
          children: cells.map(
            (c, i) =>
              new TableCell({
                children: [new Paragraph({ alignment: !bold && s.table!.numeric?.includes(i) ? AlignmentType.RIGHT : AlignmentType.LEFT, children: [new TextRun({ text: c, bold, size: 16 })] })],
              }),
          ),
        });
      children.push(
        new Table({
          width: { size: 100, type: WidthType.PERCENTAGE },
          rows: [mk(s.table.columns, true), ...s.table.rows.map((r) => mk(r.map((v, i) => fmtCell(v, !!s.table!.numeric?.includes(i))), false))],
        }),
      );
    }
  }
  const doc = new DocxDocument({ creator: "FINTRACE", title: m.title, sections: [{ children }] });
  return Packer.toBuffer(doc);
}

