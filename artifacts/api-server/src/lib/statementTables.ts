import { round2 } from "./finance";
import type { StoredRow } from "./statementRows";

/**
 * Builds month-wise and entry-wise statement tables from chosen bank rows, entirely in code,
 * so long schedules (hundreds of rows) are exact and need not be written out by the model.
 * The model places a marker such as [[S1:monthly]] in its answer; the server swaps in the table.
 */
const inr = (n: number) => new Intl.NumberFormat("en-IN", { maximumFractionDigits: 2 }).format(n);
const cell = (s: string) => s.replace(/\|/g, "/");
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const monthLabel = (key: string) => `${MONTHS[Number(key.slice(5, 7)) - 1]}-${key.slice(0, 4)}`;

type Picked = StoredRow & { side: "credit" | "debit"; amount: number };

export type StatementTables = { monthly: string; entries: string };

export function buildStatementTables(rows: StoredRow[], creditRefs: string[], debitRefs: string[], creditLabel = "Credited", debitLabel = "Recovered") {
  const byRef = new Map(rows.map((r) => [`${r.documentId}:${r.no}`, r]));
  const unknownRefs: string[] = [];
  const pick = (refs: string[], side: "credit" | "debit"): Picked[] =>
    [...new Set(refs)].flatMap((ref) => {
      const r = byRef.get(ref);
      if (!r || !r[side]) {
        unknownRefs.push(ref);
        return [];
      }
      return [{ ...r, side, amount: r[side]! }];
    });
  const picked = [...pick(creditRefs, "credit"), ...pick(debitRefs, "debit")].sort(
    (a, b) => (a.isoDate ?? "9999").localeCompare(b.isoDate ?? "9999") || a.documentId - b.documentId || a.no - b.no,
  );
  const sum = (list: Picked[], side: "credit" | "debit") => round2(list.filter((p) => p.side === side).reduce((s, p) => s + p.amount, 0));
  const totalCr = sum(picked, "credit");
  const totalDr = sum(picked, "debit");

  // Month-wise: every calendar month from first to last dated entry, including months with no entry.
  const dated = picked.filter((p) => p.isoDate);
  const byMonth = new Map<string, Picked[]>();
  for (const p of dated) byMonth.set(p.isoDate!.slice(0, 7), [...(byMonth.get(p.isoDate!.slice(0, 7)) ?? []), p]);
  const keys: string[] = [];
  if (dated.length) {
    let [y, m] = dated[0]!.isoDate!.slice(0, 7).split("-").map(Number) as [number, number];
    const last = dated[dated.length - 1]!.isoDate!.slice(0, 7);
    for (;;) {
      const k = `${y}-${String(m).padStart(2, "0")}`;
      keys.push(k);
      if (k >= last) break;
      if (++m > 12) [y, m] = [y + 1, 1];
    }
  }
  const mLines: string[] = [`| Sl. | Month | No. | ${creditLabel} (₹) | ${debitLabel} (₹) | Net (₹) | Dates and amounts |`, "|---|---|---|---|---|---|---|"];
  const emptyMonths: string[] = [];
  let sl = 0;
  keys.forEach((k, i) => {
    const list = byMonth.get(k) ?? [];
    const cr = sum(list, "credit");
    const dr = sum(list, "debit");
    const n = list.filter((p) => p.side === "credit").length;
    if (!list.length) emptyMonths.push(monthLabel(k));
    const detail = list.length
      ? list.map((p) => `${p.date.slice(0, 5)}: ${p.side === "debit" ? "less " : ""}${inr(p.amount)}`).join("; ")
      : "No entry this month";
    mLines.push(`| ${++sl} | ${monthLabel(k)} | ${n} | ${cr ? inr(cr) : ""} | ${dr ? inr(dr) : ""} | ${inr(round2(cr - dr))} | ${cell(detail)} |`);
    const year = k.slice(0, 4);
    if (keys[i + 1]?.slice(0, 4) !== year) {
      const yl = dated.filter((p) => p.isoDate!.startsWith(year));
      const ycr = sum(yl, "credit");
      const ydr = sum(yl, "debit");
      mLines.push(`| | **Total ${year}** | | **${inr(ycr)}** | **${ydr ? inr(ydr) : ""}** | **${inr(round2(ycr - ydr))}** | |`);
    }
  });
  const undated = picked.filter((p) => !p.isoDate);
  if (undated.length) mLines.push(`| | Undated entries | ${undated.filter((p) => p.side === "credit").length} | ${inr(sum(undated, "credit"))} | ${inr(sum(undated, "debit"))} | ${inr(round2(sum(undated, "credit") - sum(undated, "debit")))} | |`);
  mLines.push(`| | **GRAND TOTAL** | **${picked.filter((p) => p.side === "credit").length}** | **${inr(totalCr)}** | **${totalDr ? inr(totalDr) : ""}** | **${inr(round2(totalCr - totalDr))}** | ${keys.length ? `${monthLabel(keys[0]!)} – ${monthLabel(keys[keys.length - 1]!)} (${keys.length} months)` : ""} |`);

  const eLines: string[] = ["| Sl. | Date | Particulars | Document, page | Credit (₹) | Debit (₹) | Balance check |", "|---|---|---|---|---|---|---|"];
  picked.forEach((p, i) =>
    eLines.push(
      `| ${i + 1} | ${p.date} | ${cell(p.particulars)} | ${cell(p.documentName)}, p. ${p.page} | ${p.side === "credit" ? inr(p.amount) : ""} | ${p.side === "debit" ? inr(p.amount) : ""} | ${p.check === "review" ? `⚠ check original${p.suggested ? ` (balance suggests ${inr(p.suggested)})` : ""}` : "✓"} |`,
    ),
  );
  eLines.push(`| | | **TOTAL** | | **${inr(totalCr)}** | **${totalDr ? inr(totalDr) : ""}** | |`);
  if (totalDr) eLines.push(`| | | **NET (credits − debits)** | | **${inr(round2(totalCr - totalDr))}** | | |`);

  return {
    tables: { monthly: mLines.join("\n"), entries: eLines.join("\n") } satisfies StatementTables,
    summary: {
      creditEntries: picked.filter((p) => p.side === "credit").length,
      debitEntries: picked.filter((p) => p.side === "debit").length,
      totalCredit: totalCr,
      totalDebit: totalDr,
      net: round2(totalCr - totalDr),
      firstMonth: keys[0] ? monthLabel(keys[0]) : null,
      lastMonth: keys.length ? monthLabel(keys[keys.length - 1]!) : null,
      months: keys.length,
      monthsWithNoEntry: emptyMonths,
      rowsNeedingReview: picked.filter((p) => p.check === "review").map((p) => ({ ref: `${p.documentId}:${p.no}`, date: p.date, particulars: p.particulars, amount: p.amount, ...(p.suggested ? { balanceSuggestsAmount: p.suggested } : {}) })),
      unknownRefs,
    },
  };
}

/** Replaces [[S1:monthly]] / [[S1:entries]] markers with the stored tables. */
export function expandStatementMarkers(answer: string, tables: Map<string, StatementTables>): string {
  return answer.replace(/\[\[\s*(S\d+)\s*:\s*(monthly|entries)\s*\]\]/g, (m, id: string, kind: "monthly" | "entries") => {
    const t = tables.get(id);
    return t ? `\n\n${t[kind]}\n\n` : m;
  });
}
