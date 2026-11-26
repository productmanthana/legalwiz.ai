import { createHash } from "node:crypto";
import Papa from "papaparse";
import * as XLSX from "xlsx";
import { financialYearOf, round2 } from "./finance";

export type ParsedRow = {
  sourceRow: number;
  txnDate: string;
  valueDate: string | null;
  description: string;
  referenceNumber: string | null;
  debit: number;
  credit: number;
  balance: number | null;
  financialYear: string;
  dedupeKey: string;
};

export type ParseOutcome = {
  rows: ParsedRow[];
  rowsRead: number;
  detectedColumns: string[];
  errors: string[];
  warnings: string[];
};

const MONTHS: Record<string, number> = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, sept: 9, oct: 10, nov: 11, dec: 12,
};

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

function validYmd(y: number, m: number, d: number): string | null {
  if (!(y > 1900 && y < 2200 && m >= 1 && m <= 12 && d >= 1 && d <= 31)) return null;
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (dt.getUTCMonth() !== m - 1) return null;
  return `${y}-${pad(m)}-${pad(d)}`;
}

/** Parses Indian bank statement date formats. Day-first is assumed for numeric dates. */
export function parseDate(v: unknown): string | null {
  if (v == null || v === "") return null;
  if (v instanceof Date && !isNaN(v.getTime())) {
    return validYmd(v.getFullYear(), v.getMonth() + 1, v.getDate());
  }
  if (typeof v === "number") {
    // Excel serial date
    if (v > 20000 && v < 80000) {
      const ms = Math.round((v - 25569) * 86400000);
      const d = new Date(ms);
      return validYmd(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate());
    }
    return null;
  }
  const s = String(v).trim().replace(/\s+/g, " ");
  let m = s.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/);
  if (m) return validYmd(+m[1]!, +m[2]!, +m[3]!);
  m = s.match(/^(\d{1,2})[-/. ](\d{1,2})[-/. ](\d{2,4})$/);
  if (m) {
    let y = +m[3]!;
    if (y < 100) y += y >= 70 ? 1900 : 2000;
    return validYmd(y, +m[2]!, +m[1]!);
  }
  m = s.match(/^(\d{1,2})[-/. ]([A-Za-z]{3,4})[a-z]*[-/., ]+(\d{2,4})$/);
  if (m) {
    const mon = MONTHS[m[2]!.toLowerCase()];
    let y = +m[3]!;
    if (y < 100) y += y >= 70 ? 1900 : 2000;
    if (mon) return validYmd(y, mon, +m[1]!);
  }
  return null;
}

/** Parses amounts like "1,23,456.00", "₹ 500", "(200.00)", "500.00 Cr". Returns null when blank. */
export function parseAmount(v: unknown): number | null {
  if (v == null) return null;
  if (typeof v === "number") return isFinite(v) ? v : null;
  let s = String(v).trim();
  if (s === "" || s === "-" || s === "--") return null;
  let neg = false;
  if (/^\(.*\)$/.test(s)) {
    neg = true;
    s = s.slice(1, -1);
  }
  s = s.replace(/(INR|Rs\.?|₹)/gi, "").replace(/\s*(cr|dr)\.?$/i, "").replace(/[,\s]/g, "");
  if (s.startsWith("-")) {
    neg = !neg;
    s = s.slice(1);
  }
  if (!/^\d*\.?\d+$/.test(s)) return null;
  const n = parseFloat(s);
  return neg ? -n : n;
}

type ColKey = "date" | "valueDate" | "description" | "reference" | "debit" | "credit" | "amount" | "drcr" | "balance";

function classifyHeader(h: string): ColKey | null {
  const s = h.toLowerCase().replace(/[^a-z ]/g, " ").replace(/\s+/g, " ").trim();
  if (!s) return null;
  if (/value ?d(ate|t)/.test(s)) return "valueDate";
  if (/balance/.test(s)) return "balance";
  if (/withdraw|debit|^dr$|^dr amount|paid out/.test(s)) return "debit";
  if (/deposit|credit|^cr$|^cr amount|paid in/.test(s)) return "credit";
  if (/narration|description|particular|details|remarks|transaction remarks/.test(s)) return "description";
  if (/chq|cheque|ref/.test(s)) return "reference";
  if (/^(dr ?\/? ?cr|type|cr ?\/? ?dr)$/.test(s)) return "drcr";
  if (/amount/.test(s)) return "amount";
  if (/date|^dt$/.test(s)) return "date";
  return null;
}

function findHeader(grid: unknown[][]): { index: number; map: Partial<Record<ColKey, number>> } | null {
  for (let i = 0; i < Math.min(grid.length, 30); i++) {
    const row = grid[i] ?? [];
    const map: Partial<Record<ColKey, number>> = {};
    row.forEach((cell, idx) => {
      const k = classifyHeader(String(cell ?? ""));
      if (k && map[k] === undefined) map[k] = idx;
    });
    const hasMoney = (map.debit !== undefined && map.credit !== undefined) || map.amount !== undefined;
    if (map.date !== undefined && map.description !== undefined && hasMoney) return { index: i, map };
  }
  return null;
}

function normalise(s: string): string {
  return s.toUpperCase().replace(/\s+/g, " ").trim();
}

export function dedupeKeyFor(r: Omit<ParsedRow, "dedupeKey" | "financialYear" | "sourceRow">): string {
  return createHash("sha1")
    .update([r.txnDate, r.debit.toFixed(2), r.credit.toFixed(2), normalise(r.description), r.referenceNumber ?? "", r.balance?.toFixed(2) ?? ""].join("|"))
    .digest("hex");
}

export function gridFromContent(fileType: "csv" | "xlsx", content: string): unknown[][] {
  if (fileType === "csv") {
    const parsed = Papa.parse<string[]>(content.replace(/^\uFEFF/, ""), { skipEmptyLines: true });
    return parsed.data;
  }
  const wb = XLSX.read(Buffer.from(content, "base64"), { type: "buffer", cellDates: true });
  const sheet = wb.Sheets[wb.SheetNames[0]!];
  if (!sheet) return [];
  return XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, raw: true, defval: "" });
}

export function parseStatement(grid: unknown[][]): ParseOutcome {
  const errors: string[] = [];
  const warnings: string[] = [];
  const header = findHeader(grid);
  if (!header) {
    return {
      rows: [],
      rowsRead: 0,
      detectedColumns: [],
      errors: [
        "Could not find a header row with Date, Description/Narration and Debit/Credit (or Amount) columns in the first 30 rows.",
      ],
      warnings,
    };
  }
  const { index, map } = header;
  const headerRow = grid[index] ?? [];
  const detectedColumns = (Object.entries(map) as [ColKey, number][]).map(
    ([k, i]) => `${k} = "${String(headerRow[i] ?? "").trim()}"`,
  );
  const rows: ParsedRow[] = [];
  let rowsRead = 0;
  for (let i = index + 1; i < grid.length; i++) {
    const row = grid[i] ?? [];
    if (row.every((c) => String(c ?? "").trim() === "")) continue;
    rowsRead++;
    const lineNo = i + 1;
    const txnDate = parseDate(row[map.date!]);
    const description = String(row[map.description!] ?? "").trim();
    if (!txnDate) {
      // Footer lines (totals, closing balance text) are common; treat as skipped rather than errors when no amount.
      const anyAmount = [map.debit, map.credit, map.amount].some((k) => k !== undefined && parseAmount(row[k]) !== null);
      if (anyAmount || description) warnings.push(`Row ${lineNo}: skipped — unreadable date "${String(row[map.date!] ?? "")}"`);
      rowsRead--;
      continue;
    }
    let debit = 0;
    let credit = 0;
    if (map.debit !== undefined && map.credit !== undefined) {
      debit = Math.abs(parseAmount(row[map.debit]) ?? 0);
      credit = Math.abs(parseAmount(row[map.credit]) ?? 0);
    } else if (map.amount !== undefined) {
      const raw = row[map.amount];
      const amt = parseAmount(raw);
      if (amt === null) {
        errors.push(`Row ${lineNo}: unreadable amount "${String(raw ?? "")}"`);
        continue;
      }
      const marker = map.drcr !== undefined ? String(row[map.drcr] ?? "") : String(raw ?? "");
      if (/dr|debit|withdraw/i.test(marker)) debit = Math.abs(amt);
      else if (/cr|credit|deposit/i.test(marker)) credit = Math.abs(amt);
      else if (amt < 0) debit = -amt;
      else credit = amt;
    }
    if (debit === 0 && credit === 0) {
      warnings.push(`Row ${lineNo}: skipped — no debit or credit amount`);
      continue;
    }
    if (debit > 0 && credit > 0) warnings.push(`Row ${lineNo}: both debit and credit present; both retained`);
    const balance = map.balance !== undefined ? parseAmount(row[map.balance]) : null;
    const valueDate = map.valueDate !== undefined ? parseDate(row[map.valueDate]) : null;
    const referenceNumber = map.reference !== undefined ? String(row[map.reference] ?? "").trim() || null : null;
    const base = {
      txnDate,
      valueDate,
      description: description || "(no narration)",
      referenceNumber,
      debit: round2(debit),
      credit: round2(credit),
      balance: balance === null ? null : round2(balance),
    };
    rows.push({ ...base, sourceRow: lineNo, financialYear: financialYearOf(txnDate), dedupeKey: dedupeKeyFor(base) });
  }
  if (rows.length === 0 && errors.length === 0) errors.push("No transaction rows were found below the header row.");
  if (rows.length > 1 && rows[0]!.txnDate > rows[rows.length - 1]!.txnDate) {
    rows.reverse();
    warnings.push("Statement was in newest-first order; rows were processed oldest-first for balance checking.");
  }
  return { rows, rowsRead, detectedColumns, errors, warnings };
}

export function balanceCheck(
  rows: ParsedRow[],
  declaredOpening: number | null | undefined,
  declaredClosing: number | null | undefined,
): { status: "passed" | "failed" | "not_available"; computedClosing: number | null; declaredClosing: number | null; breaks: number; notes: string[] } {
  const notes: string[] = [];
  const withBal = rows.filter((r) => r.balance !== null);
  if (rows.length === 0 || (withBal.length === 0 && declaredOpening == null)) {
    return { status: "not_available", computedClosing: null, declaredClosing: declaredClosing ?? null, breaks: 0, notes };
  }
  // Statements may be newest-first; detect order by comparing running balances both ways.
  let breaks = 0;
  for (let i = 1; i < rows.length; i++) {
    const prev = rows[i - 1]!;
    const cur = rows[i]!;
    if (prev.balance === null || cur.balance === null) continue;
    const expected = round2(prev.balance + cur.credit - cur.debit);
    if (Math.abs(expected - cur.balance) > 0.01) {
      breaks++;
      if (breaks <= 10) notes.push(`Row ${cur.sourceRow}: running balance ${cur.balance.toFixed(2)} differs from expected ${expected.toFixed(2)}`);
    }
  }
  const first = rows[0]!;
  const opening =
    declaredOpening ?? (first.balance !== null ? round2(first.balance - first.credit + first.debit) : null);
  if (declaredOpening != null && first.balance !== null) {
    const expectedFirst = round2(declaredOpening + first.credit - first.debit);
    if (Math.abs(expectedFirst - first.balance) > 0.01) {
      breaks++;
      notes.push(`Declared opening balance ${declaredOpening.toFixed(2)} does not agree with the first row balance`);
    }
  }
  const totalCredit = rows.reduce((s, r) => s + r.credit, 0);
  const totalDebit = rows.reduce((s, r) => s + r.debit, 0);
  const computedClosing = opening === null ? null : round2(opening + totalCredit - totalDebit);
  let status: "passed" | "failed" = breaks === 0 ? "passed" : "failed";
  if (declaredClosing != null && computedClosing !== null && Math.abs(declaredClosing - computedClosing) > 0.01) {
    status = "failed";
    notes.push(`Computed closing balance ${computedClosing.toFixed(2)} does not agree with declared closing ${declaredClosing.toFixed(2)}`);
  }
  const last = rows[rows.length - 1]!;
  if (computedClosing !== null && last.balance !== null && Math.abs(last.balance - computedClosing) > 0.01 && breaks === 0) {
    status = "failed";
    notes.push("Last row balance does not agree with computed closing balance");
  }
  return { status, computedClosing, declaredClosing: declaredClosing ?? null, breaks, notes };
}
