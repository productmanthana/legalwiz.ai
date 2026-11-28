import { parseDate } from "./statementImport";
import { round2 } from "./finance";

/**
 * Transaction rows read from scanned bank statements / passbooks.
 * Rows are checked against the printed running balance: a row whose amount sits in the
 * wrong column is corrected, a repeated row is dropped, and anything else that does not
 * reconcile is flagged for review. Rows are stored in page text as a fixed Markdown table
 * so the assistant can query them later without a separate store.
 */
export type RowKind = "txn" | "brought_forward" | "carried_forward" | "total";
export type RowCheck = "ok" | "corrected" | "review" | "opening" | "unchecked" | "summary";
export type TxnRow = {
  date: string;
  ref: string;
  particulars: string;
  debit: number | null;
  credit: number | null;
  balance: number | null;
  kind: RowKind;
  check?: RowCheck;
};

const CHECK_LABEL: Record<RowCheck, string> = {
  ok: "✓ balance agrees",
  corrected: "✓ column corrected by balance",
  review: "⚠ does not agree with balance — check original",
  opening: "first row (no prior balance)",
  unchecked: "no balance printed",
  summary: "summary line (not a transaction)",
};
const LABEL_CHECK = new Map(Object.entries(CHECK_LABEL).map(([k, v]) => [v, k as RowCheck]));
export const TABLE_HEADER = "| # | Date | Ref | Particulars | Debit | Credit | Balance | Check |";

const near = (a: number, b: number) => Math.abs(a - b) < 0.015;
const num = (v: unknown): number | null => {
  if (v == null || v === "") return null;
  const n = typeof v === "number" ? v : Number(String(v).replace(/[,₹\s]/g, ""));
  return Number.isFinite(n) ? round2(n) : null;
};

/** Normalises a row as returned by the vision model. */
export function cleanRow(r: Record<string, unknown>): TxnRow | null {
  const kind = (["brought_forward", "carried_forward", "total"].includes(String(r.kind)) ? r.kind : "txn") as RowKind;
  const row: TxnRow = {
    date: String(r.date ?? "").trim(),
    ref: String(r.ref ?? "").trim(),
    particulars: String(r.particulars ?? "").replace(/\s+/g, " ").trim(),
    debit: num(r.debit),
    credit: num(r.credit),
    balance: num(r.balance),
    kind,
  };
  if (row.debit === 0) row.debit = null;
  if (row.credit === 0) row.credit = null;
  if (kind === "txn" && row.debit == null && row.credit == null && row.balance == null) return null;
  return row;
}

const sameRow = (a: TxnRow, b: TxnRow) =>
  a.kind === b.kind && a.date === b.date && a.debit === b.debit && a.credit === b.credit && a.balance === b.balance;

/** Joins rows read from overlapping strips, dropping rows the overlap repeated. */
export function joinStripRows(strips: TxnRow[][]): TxnRow[] {
  const out: TxnRow[] = [];
  for (const rows of strips) {
    const tail = out.slice(-6);
    let skip = 0;
    while (skip < Math.min(rows.length, 6) && tail.some((t) => sameRow(t, rows[skip]!))) skip++;
    out.push(...rows.slice(skip));
  }
  return out;
}

/** Joins transcribed text of overlapping strips, dropping lines the overlap repeated. */
export function joinStripText(strips: string[]): string {
  const norm = (l: string) => l.toLowerCase().replace(/[\s|:-]+/g, " ").trim();
  const isSep = (l: string) => /^\|?\s*:?-{3,}/.test(l.trim());
  let acc: string[] = [];
  const headers = new Set<string>();
  for (const s of strips) {
    let lines = s.split("\n").filter((l, i, a) => l.trim() || (i > 0 && a[i - 1]!.trim()));
    while (lines.length && !lines[0]!.trim()) lines.shift();
    // A table continued from the previous strip: drop its repeated header row.
    if (lines.length > 1 && isSep(lines[1]!) && headers.has(norm(lines[0]!))) lines = lines.slice(2);
    const a = acc.filter((l) => l.trim());
    for (let k = Math.min(10, a.length, lines.length); k > 0; k--) {
      if (a.slice(-k).every((l, i) => norm(l) === norm(lines[i]!))) {
        lines = lines.slice(k);
        break;
      }
    }
    lines.forEach((l, i) => {
      if (i + 1 < lines.length && isSep(lines[i + 1]!)) headers.add(norm(l));
    });
    acc = acc.concat(lines);
  }
  return acc.join("\n").trim();
}

/**
 * Walks rows in statement order checking prev balance + credit − debit = balance.
 * Mutates each row's check (and swaps debit/credit when the balance proves the column was misread).
 * Returns the rows that remain (exact repeats removed).
 */
export function reconcileRows(rows: TxnRow[], openingBalance: number | null = null): TxnRow[] {
  const out: TxnRow[] = [];
  let prev = openingBalance;
  for (const r of rows) {
    if (r.kind !== "txn") {
      r.check = "summary";
      if (r.kind === "brought_forward" && r.balance != null) prev = r.balance;
      out.push(r);
      continue;
    }
    const dr = r.debit ?? 0;
    const cr = r.credit ?? 0;
    if (r.balance == null) {
      r.check = "unchecked";
      if (prev != null) prev = round2(prev + cr - dr);
    } else if (prev == null) {
      r.check = "opening";
      prev = r.balance;
    } else if (near(prev + cr - dr, r.balance)) {
      r.check = "ok";
      prev = r.balance;
    } else if (near(prev + dr - cr, r.balance)) {
      [r.debit, r.credit] = [r.credit, r.debit];
      r.check = "corrected";
      prev = r.balance;
    } else {
      const last = out[out.length - 1];
      if (last && sameRow(last, r)) continue; // the same row read twice
      r.check = "review";
      prev = r.balance;
    }
    out.push(r);
  }
  return out;
}

export const reviewCount = (rows: TxnRow[]) => rows.filter((r) => r.check === "review").length;

const money = (n: number | null) => (n == null ? "" : n.toFixed(2));
const cell = (s: string) => s.replace(/\|/g, "/");

/** Markdown table + balance-check note for one page's rows; numbering continues across pages. */
export function renderRows(rows: TxnRow[], startNo: number): string {
  if (!rows.length) return "";
  let n = startNo;
  const lines = rows.map((r) => {
    const no = r.kind === "txn" ? String(n++) : "";
    const bal = r.balance == null ? "" : `${Math.abs(r.balance).toFixed(2)}${r.balance < 0 ? " DR" : " CR"}`;
    const parts = r.kind === "txn" ? r.particulars : `${r.particulars || r.kind.replace("_", " ")} [${r.kind.replace("_", " ")}]`;
    return `| ${no} | ${cell(r.date)} | ${cell(r.ref)} | ${cell(parts)} | ${money(r.debit)} | ${money(r.credit)} | ${bal} | ${CHECK_LABEL[r.check ?? "unchecked"]} |`;
  });
  const txns = rows.filter((r) => r.kind === "txn");
  const corrected = txns.filter((r) => r.check === "corrected").length;
  const review = reviewCount(txns);
  const note =
    `Running-balance check: ${txns.length} transaction row(s); ${txns.filter((r) => r.check === "ok" || r.check === "corrected").length} agree with the printed balance` +
    (corrected ? `, ${corrected} had debit/credit columns corrected` : "") +
    (review ? `, ${review} do NOT agree and must be checked against the original` : "") +
    ".";
  return `[Transaction rows — read by vision model and checked against the running balance]\n${TABLE_HEADER}\n|---|---|---|---|---|---|---|---|\n${lines.join("\n")}\n\n${note}`;
}

/** suggested: amount the running balance implies for a flagged row (when the next row's amount is right). */
export type StoredRow = TxnRow & { documentId: number; documentName: string; page: number; no: number; isoDate: string | null; suggested?: number };

/** Reads the rows back out of page text written by renderRows. */
export function parseStoredRows(pages: { documentId: number; documentName: string; pageNumber: number; content: string }[]): StoredRow[] {
  const out: StoredRow[] = [];
  for (const p of pages) {
    const at = p.content.indexOf(TABLE_HEADER);
    if (at < 0) continue;
    for (const line of p.content.slice(at).split("\n").slice(2)) {
      if (!line.startsWith("|")) break;
      const c = line.split("|").slice(1, -1).map((s) => s.trim());
      if (c.length !== 8 || !c[0]) continue; // summary lines have no number
      const bal = c[6]!.match(/^([\d.]+)\s*(DR|CR)?$/);
      out.push({
        documentId: p.documentId,
        documentName: p.documentName,
        page: p.pageNumber,
        no: Number(c[0]),
        date: c[1]!,
        isoDate: parseDate(c[1]),
        ref: c[2]!,
        particulars: c[3]!,
        debit: num(c[4]),
        credit: num(c[5]),
        balance: bal ? Number(bal[1]) * (bal[2] === "DR" ? -1 : 1) : null,
        kind: "txn",
        check: LABEL_CHECK.get(c[7]!) ?? "unchecked",
      });
    }
  }
  // A mismatch can come from a misread amount AND balance on the row before (both agree with each
  // other, so that row passed); the mismatch only surfaces on the next row. Flag both rows.
  for (let i = out.length - 1; i > 0; i--) {
    const r = out[i]!;
    const prev = out[i - 1]!;
    if (r.check === "review" && prev.documentId === r.documentId && prev.no === r.no - 1 && (prev.check === "ok" || prev.check === "corrected")) {
      prev.check = "review";
      // If this row's amount is right, the balance before it fixes the previous row's amount.
      const before = out[i - 2];
      if (r.balance != null && before?.balance != null && before.documentId === r.documentId && before.no === r.no - 2) {
        const implied = round2(r.balance - (r.credit ?? 0) + (r.debit ?? 0) - before.balance);
        // Skip implausible values (more than 10× the read amount): then the next row is the misread one.
        const amt = prev.credit ?? prev.debit ?? 0;
        const v = prev.credit != null ? implied : -implied;
        if (v > 0 && v <= amt * 10 && !near(v, amt)) prev.suggested = v;
      }
    }
  }
  return out;
}

export type SearchQuery = { includeAny?: string[]; excludeAny?: string[]; onDate?: string; fromDate?: string; toDate?: string };

function editDistance(a: string, b: string): number {
  const d = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    let prev = d[0]!;
    d[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const tmp = d[j]!;
      d[j] = Math.min(d[j]! + 1, d[j - 1]! + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1));
      prev = tmp;
    }
  }
  return d[b.length]!;
}

/**
 * Name match that tolerates OCR misreads and truncated narrations: the keyword appears in the
 * text, or a word of the text (5+ letters) is part of the keyword (e.g. "BHADRE" in
 * "kalaveerabhadreshwara"), or is within a small edit distance of it.
 */
export function fuzzyNameMatch(text: string, keyword: string): boolean {
  const k = keyword.toLowerCase().replace(/[^a-z0-9]/g, "");
  if (!k) return false;
  const t = text.toLowerCase();
  if (t.includes(keyword.toLowerCase())) return true;
  for (const w of t.split(/[^a-z0-9]+/)) {
    if (w.length < 5 || /^\d+$/.test(w)) continue;
    if (k.includes(w)) return true;
    if (k.length >= 5 && w.includes(k)) return true;
    const n = Math.min(w.length, k.length);
    if (n >= 6 && editDistance(w.slice(0, n), k.slice(0, n)) <= Math.floor(n / 4)) return true;
  }
  return false;
}

/** Bank codes that are not a party's name. */
const CODE_WORDS = new Set(["by", "ey", "to", "inst", "micr", "out", "imps", "impsab", "ubino", "ubin0", "upi", "upiab", "clg", "chq", "cheque", "neft", "rtgs", "cr", "dr", "trf", "ac", "a/c"]);
/** Narrations that carry no party name (cheque clearing, IMPS/UPI codes, bare numbers or references). */
const isUnnamed = (p: string) => !/\bcash\b/i.test(p) && !p.toLowerCase().split(/[^a-z]+/).some((w) => w.length >= 4 && !CODE_WORDS.has(w));

const monthsBetween = (a: string, b: string) => (Number(b.slice(0, 4)) - Number(a.slice(0, 4))) * 12 + Number(b.slice(5, 7)) - Number(a.slice(5, 7));

/** Every debit AND credit row matching names/keywords and dates, across all years, with per-year totals. */
export function searchRows(rows: StoredRow[], q: SearchQuery) {
  const inc = (q.includeAny ?? []).filter((s) => s.trim());
  const exc = (q.excludeAny ?? []).map((s) => s.toLowerCase()).filter(Boolean);
  const from = q.onDate || q.fromDate;
  const to = q.onDate || q.toDate;
  const inRange = (r: StoredRow) => !(from && (!r.isoDate || r.isoDate < from)) && !(to && (!r.isoDate || r.isoDate > to));
  const isTxn = (r: StoredRow) => r.kind === "txn" && !!(r.debit || r.credit);
  const matched = rows.filter((r) => {
    if (!isTxn(r) || !inRange(r)) return false;
    const hay = `${r.particulars} ${r.ref}`;
    if (inc.length && !inc.some((k) => fuzzyNameMatch(hay, k))) return false;
    if (exc.some((k) => hay.toLowerCase().includes(k))) return false;
    return true;
  }).sort((a, b) => (a.isoDate ?? "").localeCompare(b.isoDate ?? ""));
  const byYear = new Map<string, { year: string; count: number; debit: number; credit: number }>();
  for (const r of matched) {
    const y = r.isoDate?.slice(0, 4) ?? "unknown";
    const e = byYear.get(y) ?? { year: y, count: 0, debit: 0, credit: 0 };
    e.count++; e.debit = round2(e.debit + (r.debit ?? 0)); e.credit = round2(e.credit + (r.credit ?? 0));
    byYear.set(y, e);
  }
  // For a name search: entries with no name in the narration, near the named ones in time and of
  // similar size — the statement cannot say who paid them, but they may be the same party.
  const related: StoredRow[] = [];
  if (inc.length && matched.length) {
    const keys = new Set(matched.map((r) => `${r.documentId}:${r.no}`));
    for (const r of rows) {
      if (!isTxn(r) || !r.isoDate || keys.has(`${r.documentId}:${r.no}`) || !isUnnamed(r.particulars)) continue;
      const near = matched.filter((m) => m.isoDate && Math.abs(monthsBetween(m.isoDate, r.isoDate!)) <= 24);
      const col = r.credit ? "credit" : "debit";
      if (near.some((m) => m[col] && Math.abs(m[col]! - r[col]!) <= m[col]! * 0.3)) related.push(r);
    }
  }
  const debit = round2(matched.reduce((s, r) => s + (r.debit ?? 0), 0));
  const credit = round2(matched.reduce((s, r) => s + (r.credit ?? 0), 0));
  const view = (r: StoredRow) => ({ ref: `${r.documentId}:${r.no}`, documentId: r.documentId, document: r.documentName, page: r.page, date: r.date, particulars: r.particulars, debit: r.debit, credit: r.credit, balance: r.balance, check: r.check });
  return {
    matchedRows: matched.length,
    totalDebit: debit,
    totalCredit: credit,
    netCreditMinusDebit: round2(credit - debit),
    byYear: [...byYear.values()],
    rowsNeedingReview: reviewCount(matched),
    rows: matched.slice(0, 1000).map(view),
    possiblyRelatedUnnamed: {
      count: related.length,
      totalDebit: round2(related.reduce((s, r) => s + (r.debit ?? 0), 0)),
      totalCredit: round2(related.reduce((s, r) => s + (r.credit ?? 0), 0)),
      note: "These narrations carry no party name (cheque clearing, IMPS/UPI). They fall within 24 months of a named entry and are of similar amount, so they MAY be from the same party. The statement cannot confirm the payer: list them separately and never add them to the named total.",
      rows: related.slice(0, 300).map(view),
    },
  };
}

export type RowQuery = {
  column: "credit" | "debit";
  rowRefs?: string[];
  includeAny?: string[];
  excludeAny?: string[];
  documentIds?: number[];
  fromDate?: string;
  toDate?: string;
};

/** Exact total of the rows matching a query (keywords match particulars or ref, case-insensitive). */
export function sumRows(rows: StoredRow[], q: RowQuery) {
  const inc = (q.includeAny ?? []).map((s) => s.toLowerCase()).filter(Boolean);
  const exc = (q.excludeAny ?? []).map((s) => s.toLowerCase()).filter(Boolean);
  const refs = new Set(q.rowRefs ?? []);
  const matched = rows.filter((r) => {
    const amt = r[q.column];
    if (!amt) return false;
    if (refs.size) return refs.has(`${r.documentId}:${r.no}`);
    const hay = `${r.particulars} ${r.ref}`.toLowerCase();
    if (inc.length && !inc.some((k) => hay.includes(k))) return false;
    if (exc.some((k) => hay.includes(k))) return false;
    if (q.documentIds?.length && !q.documentIds.includes(r.documentId)) return false;
    if (q.fromDate && (!r.isoDate || r.isoDate < q.fromDate)) return false;
    if (q.toDate && (!r.isoDate || r.isoDate > q.toDate)) return false;
    return true;
  });
  const total = round2(matched.reduce((s, r) => s + (r[q.column] ?? 0), 0));
  return {
    matchedRows: matched.length,
    total,
    rowsNeedingReview: reviewCount(matched),
    rows: matched.slice(0, 1000).map((r) => ({ ref: `${r.documentId}:${r.no}`, page: r.page, date: r.date, particulars: r.particulars, amount: r[q.column], check: r.check, ...(r.suggested ? { balanceSuggestsAmount: r.suggested } : {}) })),
  };
}
