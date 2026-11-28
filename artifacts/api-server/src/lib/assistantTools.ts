import type { AiTool } from "./ai";
import type { PagePassage } from "./assistantContext";
import { round2 } from "./finance";
import { parseStoredRows, searchRows, sumRows, type RowQuery, type SearchQuery } from "./statementRows";
import { buildStatementTables, type StatementTables } from "./statementTables";

const strList = { type: "array", items: { type: "string" } };

/**
 * Tools that let the assistant get exact totals computed in code instead of adding numbers itself.
 * `tables` collects statement tables built during the answer, keyed by their marker id (S1, S2…).
 */
type LedgerTxn = { id: number; txnDate: string; description: string; debit: number; credit: number; documentIds: number[] };

export function assistantTools(passages: PagePassage[], ledger: LedgerTxn[] = []): { tools: AiTool[]; tables: Map<string, StatementTables> } {
  const rows = parseStoredRows(passages);
  const tables = new Map<string, StatementTables>();
  const tools: AiTool[] = [
    {
      name: "search_transactions",
      description:
        `Finds EVERY transaction, debits and credits together, in all uploaded statements (${rows.length} rows) and the case ledger (${ledger.length} transactions), across all years. ` +
        "Use it for questions about a person, party or account (e.g. every transaction with \"Jayappa\" — a 2022 debit and a 2025 credit are both returned), or about a particular day (onDate) or period. " +
        "A row matches when its particulars contain ANY includeAny keyword (case-insensitive; pass name spelling variants and parts, e.g. [\"jayappa\", \"jayapa\", \"jaiappa\"]; empty = all rows), NO excludeAny keyword, and its date is in range. " +
        "Returns statement rows with documentId and page (for citing the page), totals by year, total debit, total credit and net, plus matching ledger transactions.",
      parameters: {
        type: "object",
        properties: {
          includeAny: strList,
          excludeAny: strList,
          onDate: { type: "string", description: "YYYY-MM-DD, a single day" },
          fromDate: { type: "string", description: "YYYY-MM-DD, inclusive" },
          toDate: { type: "string", description: "YYYY-MM-DD, inclusive" },
        },
      },
      run: (args) => {
        const q = args as SearchQuery;
        const inc = (q.includeAny ?? []).map((s) => s.toLowerCase()).filter(Boolean);
        const exc = (q.excludeAny ?? []).map((s) => s.toLowerCase()).filter(Boolean);
        const from = q.onDate || q.fromDate;
        const to = q.onDate || q.toDate;
        const led = ledger.filter((t) => {
          const hay = t.description.toLowerCase();
          if (inc.length && !inc.some((k) => hay.includes(k))) return false;
          if (exc.some((k) => hay.includes(k))) return false;
          if (from && t.txnDate < from) return false;
          if (to && t.txnDate > to) return false;
          return true;
        }).sort((a, b) => a.txnDate.localeCompare(b.txnDate));
        return {
          statementRows: searchRows(rows, q),
          ledgerTransactions: {
            matched: led.length,
            totalDebit: round2(led.reduce((s, t) => s + t.debit, 0)),
            totalCredit: round2(led.reduce((s, t) => s + t.credit, 0)),
            rows: led.slice(0, 500).map((t) => ({ transactionId: t.id, date: t.txnDate, description: t.description.slice(0, 120), debit: t.debit, credit: t.credit, documentIds: t.documentIds })),
          },
          note: "Ledger transactions may be the same entries as statement rows (imported from the same statement): match them by date and amount and never add both.",
        };
      },
    },
    {
      name: "sum_statement_rows",
      description:
        `Exact total of bank-statement transaction rows (${rows.length} rows available) in the debit or credit column. ` +
        "Either pass rowRefs (\"documentId:rowNo\" as returned in each row's ref) to total exactly those rows, or filter: a row matches when its particulars or ref contain ANY includeAny keyword (case-insensitive; empty = all rows), NO excludeAny keyword, and falls in the date range. Returns the total, the count and every matched row.",
      parameters: {
        type: "object",
        properties: {
          column: { type: "string", enum: ["credit", "debit"] },
          rowRefs: strList,
          includeAny: strList,
          excludeAny: strList,
          documentIds: { type: "array", items: { type: "integer" } },
          fromDate: { type: "string", description: "YYYY-MM-DD, inclusive" },
          toDate: { type: "string", description: "YYYY-MM-DD, inclusive" },
        },
        required: ["column"],
      },
      run: (args) => sumRows(rows, args as unknown as RowQuery),
    },
    {
      name: "build_statement_tables",
      description:
        "Builds, in code, a month-wise table (every month from first to last entry, with entry count, credits, debits, net, dates and amounts, year subtotals and grand total) and a full list of every entry, from exactly the rows you choose. " +
        "Pass creditRefs (rows counted in the credit column) and debitRefs (related debits, e.g. recoveries). Returns a marker id and the exact totals. Put [[<id>:monthly]] and/or [[<id>:entries]] on their own line in your answer where each table belongs; the server inserts the full table there. Never write those rows yourself.",
      parameters: {
        type: "object",
        properties: {
          creditRefs: strList,
          debitRefs: strList,
          creditLabel: { type: "string", description: "Column name for credits, e.g. \"Credited\"" },
          debitLabel: { type: "string", description: "Column name for debits, e.g. \"Recovered\"" },
        },
        required: ["creditRefs"],
      },
      run: (args) => {
        const a = args as { creditRefs?: string[]; debitRefs?: string[]; creditLabel?: string; debitLabel?: string };
        const built = buildStatementTables(rows, a.creditRefs ?? [], a.debitRefs ?? [], a.creditLabel || undefined, a.debitLabel || undefined);
        const id = `S${tables.size + 1}`;
        tables.set(id, built.tables);
        return { id, markers: [`[[${id}:monthly]]`, `[[${id}:entries]]`], ...built.summary };
      },
    },
    {
      name: "add_numbers",
      description: "Exact sum of a list of amounts. Use for any total not covered by sum_statement_rows.",
      parameters: { type: "object", properties: { values: { type: "array", items: { type: "number" } } }, required: ["values"] },
      run: (args) => {
        const values = (Array.isArray(args.values) ? args.values : []).map(Number).filter(Number.isFinite);
        return { count: values.length, total: round2(values.reduce((s, v) => s + v, 0)) };
      },
    },
  ];
  return { tools, tables };
}
