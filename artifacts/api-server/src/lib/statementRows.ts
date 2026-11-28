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

export type StoredRow = TxnRow & { documentId: number; documentName: string; page: number; no: number; isoDate: string | null };

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
  return out;
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
    rows: matched.slice(0, 1000).map((r) => ({ ref: `${r.documentId}:${r.no}`, page: r.page, date: r.date, particulars: r.particulars, amount: r[q.column], check: r.check })),
  };
}
