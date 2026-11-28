import { DISCLAIMER, type ReportModel, type ReportSection } from "./reports";

type Message = { id: number; content: string; createdAt: Date; citations: { kind: string; id: number; label: string }[] };

/** Strips inline Markdown so text reads cleanly in Excel/Word/PDF. */
const plain = (s: string) =>
  s
    .replace(/\*\*(.*?)\*\*/g, "$1")
    .replace(/__(.+?)__/g, "$1")
    .replace(/(^|\s)[*_](\S.*?\S|\S)[*_](?=\s|$|[.,;:])/g, "$1$2")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, "$1 ($2)")
    .trim();

const rawCells = (line: string) => line.trim().replace(/^\|/, "").replace(/\|$/, "").split("|");

/** "Rs. 1,25,000.50" → 125000.5; null when the cell is not an amount. */
function amount(s: string): number | null {
  const t = s.replace(/^(Rs\.?|₹|INR)\s*/i, "").replace(/,/g, "").replace(/\s*(Cr|Dr)\.?$/i, "").trim();
  return /^-?\d+(\.\d+)?$/.test(t) ? Number(t) : null;
}

/** Total / subtotal rows: a bold cell, or a label starting with Total / Grand total / Net. */
const isTotalRow = (raw: string[]) => raw.some((c) => /\*\*\S/.test(c)) || /^(sub-?total|total|grand total|net)\b/i.test(plain(raw.find((c) => plain(c)) ?? ""));

/**
 * Converts an assistant answer (Markdown) into the report model the exporters render.
 * An answer in statement format (first line "# Title", then a subject line) keeps that title
 * and subject at the top, with the sections and tables in the order the answer gives them.
 */
export function answerReport(caseTitle: string, question: string, m: Message, by: string): ReportModel {
  const answered = `Answered ${m.createdAt.toLocaleString("en-IN", { timeZone: "Asia/Kolkata" })} · exported by ${by}`;
  const lines = m.content.split("\n");
  let title = `AI Assistant answer — ${caseTitle}`;
  let subtitle = answered;
  let start = 0;
  const first = lines.findIndex((l) => l.trim());
  const statement = first >= 0 && /^#\s+\S/.test(lines[first]!);
  if (statement) {
    title = plain(lines[first]!.replace(/^#\s+/, ""));
    start = first + 1;
    const sub = lines.findIndex((l, i) => i >= start && l.trim());
    if (sub >= 0 && !/^\s*(#|\|)/.test(lines[sub]!)) {
      subtitle = `${plain(lines[sub]!)}\n${answered}`;
      start = sub + 1;
    }
  }

  const sections: ReportSection[] = statement ? [] : [{ heading: "Question", paragraphs: [question || "—"] }];
  let heading = statement ? "" : "Answer";
  let used = false; // heading already printed for the current section
  let paras: string[] = [];
  let tables = 0;
  const nextHeading = () => {
    const h = used ? "" : heading;
    used = true;
    return h;
  };
  const flush = () => {
    if (paras.length) sections.push({ heading: nextHeading(), paragraphs: paras });
    paras = [];
  };

  for (let i = start; i < lines.length; i++) {
    const line = lines[i]!;
    if (/^\s*\|/.test(line)) {
      // Markdown table: header, separator, then rows.
      const block: string[] = [];
      while (i < lines.length && /^\s*\|/.test(lines[i]!)) block.push(lines[i++]!);
      i--;
      const raw = block.filter((l) => !/^\s*\|?\s*:?-{2,}/.test(l)).map(rawCells);
      if (raw.length < 1) continue;
      const columns = raw[0]!.map(plain);
      const bodyRaw = raw.slice(1);
      const body = bodyRaw.map((r) => columns.map((_, c) => plain(r[c] ?? "")));
      const numeric = columns
        .map((_, c) => c)
        .filter((c) => {
          const filled = body.filter((r) => r[c]);
          return filled.length > 0 && filled.filter((r) => amount(r[c]!) !== null).length >= Math.ceil(filled.length * 0.8);
        });
      tables++;
      const h = heading === "Answer" && !used ? `Table ${tables}` : nextHeading();
      sections.push({
        heading: h,
        paragraphs: paras.length ? paras : undefined,
        table: {
          columns,
          rows: body.map((r) => r.map((v, c) => (numeric.includes(c) ? amount(v) ?? (v || null) : v || null))),
          numeric,
          display: body,
          boldRows: bodyRaw.map((r, ri) => (isTotalRow(r) ? ri : -1)).filter((ri) => ri >= 0),
        },
      });
      paras = [];
      continue;
    }
    const hm = line.match(/^#{1,6}\s+(.*)/);
    if (hm) {
      flush();
      heading = plain(hm[1]!);
      used = false;
      continue;
    }
    const text = plain(line.replace(/^\s*[-*+]\s+/, "• ").replace(/^\s*(\d+)\.\s+/, "$1. "));
    if (!text) continue;
    paras.push(text);
  }
  flush();
  if (statement) sections.push({ heading: "Request", paragraphs: [question || "—"] });
  if (m.citations.length) sections.push({ heading: "Sources", table: { columns: ["Type", "Record #", "Reference"], rows: m.citations.map((c) => [c.kind.replace(/_/g, " "), c.id, c.label]) } });
  sections.push({ heading: "Note", paragraphs: ["Verify every figure against the source documents before relying on it.", DISCLAIMER] });

  return { title, subtitle, sections };
}
