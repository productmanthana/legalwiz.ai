import { DISCLAIMER, type ReportModel, type ReportSection } from "./reports";

type Message = { id: number; content: string; createdAt: Date; citations: { kind: string; id: number; label: string }[] };

/** Strips inline Markdown so text reads cleanly in Excel/Word/PDF. */
const plain = (s: string) =>
  s
    .replace(/\*\*(.+?)\*\*/g, "$1")
    .replace(/__(.+?)__/g, "$1")
    .replace(/(^|\s)[*_](\S.*?\S|\S)[*_](?=\s|$|[.,;:])/g, "$1$2")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .trim();

const cells = (line: string) => line.trim().replace(/^\|/, "").replace(/\|$/, "").split("|").map((c) => plain(c));

/** "Rs. 1,25,000.50" → 125000.5; null when the cell is not an amount. */
function amount(s: string): number | null {
  const t = s.replace(/^(Rs\.?|₹|INR)\s*/i, "").replace(/,/g, "").replace(/\s*(Cr|Dr)\.?$/i, "").trim();
  return /^-?\d+(\.\d+)?$/.test(t) ? Number(t) : null;
}

/** Converts an assistant answer (Markdown) into the report model the exporters render. */
export function answerReport(caseTitle: string, question: string, m: Message, by: string): ReportModel {
  const sections: ReportSection[] = [{ heading: "Question", paragraphs: [question || "—"] }];
  const missing: string[] = [];
  let heading = "Answer";
  let paras: string[] = [];
  let inMissing = false;
  let tables = 0;
  const flush = () => {
    if (paras.length) sections.push({ heading, paragraphs: paras });
    paras = [];
  };

  const lines = m.content.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    if (/^\s*\|/.test(line)) {
      // Markdown table: header, separator, then rows.
      const block: string[] = [];
      while (i < lines.length && /^\s*\|/.test(lines[i]!)) block.push(lines[i++]!);
      i--;
      const rows = block.filter((l) => !/^\s*\|?\s*:?-{2,}/.test(l)).map(cells);
      if (rows.length < 1) continue;
      const columns = rows[0]!;
      const body = rows.slice(1);
      const numeric = columns.map((_, c) => c).filter((c) => body.length > 0 && body.filter((r) => r[c] && amount(r[c]!) !== null).length >= Math.ceil(body.filter((r) => r[c]).length * 0.8) && body.some((r) => r[c]));
      flush();
      tables++;
      sections.push({
        heading: heading === "Answer" ? `Table ${tables}` : heading,
        table: { columns, rows: body.map((r) => columns.map((_, c) => (numeric.includes(c) ? amount(r[c] ?? "") ?? (r[c] || null) : r[c] || null))), numeric },
      });
      continue;
    }
    const h = line.match(/^#{1,6}\s+(.*)/);
    if (h) {
      flush();
      heading = plain(h[1]!);
      inMissing = /missing information/i.test(heading);
      continue;
    }
    const text = plain(line.replace(/^\s*[-*+]\s+/, "• ").replace(/^\s*(\d+)\.\s+/, "$1. "));
    if (!text) continue;
    const bold = line.match(/\*\*([^*]+?)\*\*\s*:?/)?.[1] ?? "";
    if (/missing information/i.test(bold)) inMissing = true;
    else if (bold && /verified fact|user-provided|ai suggestion/i.test(bold)) inMissing = false;
    if (inMissing) missing.push(text.replace(/^•?\s*Missing information\s*:?\s*/i, "• ").replace(/^•\s*$/, ""));
    else paras.push(text);
  }
  flush();
  sections.push({ heading: "Missing information", paragraphs: missing.filter(Boolean).length ? missing.filter(Boolean) : ["None identified in this answer."] });
  if (m.citations.length) sections.push({ heading: "Sources", table: { columns: ["Type", "Record #", "Reference"], rows: m.citations.map((c) => [c.kind.replace(/_/g, " "), c.id, c.label]) } });
  sections.push({ heading: "Note", paragraphs: ["This answer is an AI suggestion. Verify every figure against the source documents before relying on it.", DISCLAIMER] });

  return { title: `AI Assistant answer — ${caseTitle}`, subtitle: `Answered ${m.createdAt.toLocaleString("en-IN", { timeZone: "Asia/Kolkata" })} · exported by ${by}`, sections };
}
