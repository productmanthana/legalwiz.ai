import { inArray, eq, sql } from "drizzle-orm";
import {
  db,
  transactionsTable,
  bankAccountsTable,
  queryResponsesTable,
  documentsTable,
  type CaseRow,
} from "@workspace/db";
import type { AccessRole } from "./access";

type TxnRow = typeof transactionsTable.$inferSelect;
type AccountRow = typeof bankAccountsTable.$inferSelect;

export function serializeCase(c: CaseRow, role: AccessRole) {
  const { ownerId: _o, ...rest } = c;
  return { ...rest, accessRole: role };
}

export function serializeTxn(t: TxnRow, acct?: Pick<AccountRow, "bankName" | "maskedAccountNumber">) {
  const {
    origDescription: _a,
    origDebit: _b,
    origCredit: _c,
    origTxnDate: _d,
    origBalance: _e,
    dedupeKey: _f,
    ...rest
  } = t;
  return {
    ...rest,
    bankName: acct?.bankName ?? "",
    maskedAccountNumber: acct?.maskedAccountNumber ?? "",
  };
}

export async function accountMap(caseId: number): Promise<Map<number, AccountRow>> {
  const rows = await db.select().from(bankAccountsTable).where(eq(bankAccountsTable.caseId, caseId));
  return new Map(rows.map((r) => [r.id, r]));
}

export async function serializeTxns(caseId: number, rows: TxnRow[]) {
  const accts = await accountMap(caseId);
  return rows.map((t) => serializeTxn(t, accts.get(t.bankAccountId)));
}

export async function txnsByIds(ids: number[]) {
  if (ids.length === 0) return [];
  const rows = await db.select().from(transactionsTable).where(inArray(transactionsTable.id, ids));
  if (rows.length === 0) return [];
  return serializeTxns(rows[0]!.caseId, rows);
}

export async function responseCounts(queryIds: number[]): Promise<Map<number, number>> {
  if (queryIds.length === 0) return new Map();
  const rows = await db
    .select({ queryId: queryResponsesTable.queryId, n: sql<number>`count(*)::int` })
    .from(queryResponsesTable)
    .where(inArray(queryResponsesTable.queryId, queryIds))
    .groupBy(queryResponsesTable.queryId);
  return new Map(rows.map((r) => [r.queryId, r.n]));
}

type DocRow = typeof documentsTable.$inferSelect;
export function serializeDocs(rows: DocRow[], allCaseDocs: DocRow[]) {
  const hashCount = new Map<string, number>();
  for (const d of allCaseDocs) hashCount.set(d.sha256, (hashCount.get(d.sha256) ?? 0) + 1);
  return rows.map((d) => ({ ...d, isDuplicate: (hashCount.get(d.sha256) ?? 0) > 1 }));
}
