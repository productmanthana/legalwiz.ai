import type { AiTool } from "./ai";
import type { PagePassage } from "./assistantContext";
import { round2 } from "./finance";
import { parseStoredRows, sumRows, type RowQuery } from "./statementRows";

const strList = { type: "array", items: { type: "string" } };

/** Tools that let the assistant get exact totals computed in code instead of adding numbers itself. */
export function assistantTools(passages: PagePassage[]): AiTool[] {
  const rows = parseStoredRows(passages);
  return [
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
      name: "add_numbers",
      description: "Exact sum of a list of amounts. Use for any total not covered by sum_statement_rows.",
      parameters: { type: "object", properties: { values: { type: "array", items: { type: "number" } } }, required: ["values"] },
      run: (args) => {
        const values = (Array.isArray(args.values) ? args.values : []).map(Number).filter(Number.isFinite);
        return { count: values.length, total: round2(values.reduce((s, v) => s + v, 0)) };
      },
    },
  ];
}
