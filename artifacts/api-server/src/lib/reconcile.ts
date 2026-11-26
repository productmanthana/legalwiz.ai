import { and, eq, inArray } from "drizzle-orm";
import { db, transactionsTable, transactionMatchesTable, bankAccountsTable } from "@workspace/db";
import { daysBetween, round2 } from "./finance";

type Txn = typeof transactionsTable.$inferSelect;

const CASH_OUT = /\b(ATM|ATW|CASH WDL|CASH WITHDRAWAL|NWD|SELF CHQ)\b/i;
const CASH_IN = /\b(CASH DEP|BY CASH|CASH DEPOSIT|CDM)\b/i;
const TRANSFER = /\b(TRF|TRANSFER|NEFT|IMPS|RTGS|UPI|SELF)\b/i;

type Candidate = {
  matchType: string;
  sourceIds: number[];
  targetIds: number[];
  amount: number;
  dateGapDays: number;
  confidence: number;
  evidence: string[];
};

/**
 * Deterministic matching engine. Produces *suggested* matches only; nothing is treated as
 * reconciled until a user approves it. Existing approved/rejected/partial decisions are kept,
 * and previously rejected pairings are never re-suggested.
 */
export async function runMatching(caseId: number): Promise<number> {
  await db
    .delete(transactionMatchesTable)
    .where(and(eq(transactionMatchesTable.caseId, caseId), eq(transactionMatchesTable.status, "suggested"), eq(transactionMatchesTable.createdBy, "engine")));

  const existing = await db.select().from(transactionMatchesTable).where(eq(transactionMatchesTable.caseId, caseId));
  const used = new Set<number>();
  const rejectedKeys = new Set<string>();
  for (const m of existing) {
    const key = [...m.sourceIds].sort().join(",") + "|" + [...m.targetIds].sort().join(",");
    if (m.status === "rejected") rejectedKeys.add(key);
    else for (const id of [...m.sourceIds, ...m.targetIds]) used.add(id);
  }

  const txns = await db.select().from(transactionsTable).where(eq(transactionsTable.caseId, caseId));
  const accounts = await db.select().from(bankAccountsTable).where(eq(bankAccountsTable.caseId, caseId));
  const ownership = new Map(accounts.map((a) => [a.id, a.ownership]));
  const isSelf = (t: Txn) => ["self", "joint"].includes(ownership.get(t.bankAccountId) ?? "");
  const isFamily = (t: Txn) => ["spouse", "family_member"].includes(ownership.get(t.bankAccountId) ?? "");

  const debits = txns.filter((t) => t.debit > 0 && !used.has(t.id)).sort((a, b) => a.txnDate.localeCompare(b.txnDate));
  const credits = txns.filter((t) => t.credit > 0 && !used.has(t.id)).sort((a, b) => a.txnDate.localeCompare(b.txnDate));
  const candidates: Candidate[] = [];
  const taken = new Set<number>();

  const tryPair = (d: Txn, c: Txn, matchType: string, maxGap: number, base: number, extra: string[]) => {
    if (taken.has(d.id) || taken.has(c.id)) return false;
    if (Math.abs(d.debit - c.credit) > 0.009) return false;
    if (c.txnDate < d.txnDate) return false;
    const gap = daysBetween(d.txnDate, c.txnDate);
    if (gap > maxGap) return false;
    const key = `${d.id}|${c.id}`;
    if (rejectedKeys.has(key)) return false;
    const evidence = [`Exact amount match: ${d.debit.toFixed(2)}`, gap === 0 ? "Same transaction date" : `Date gap of ${gap} day(s)`, ...extra];
    let confidence = base + (gap === 0 ? 15 : gap <= 1 ? 10 : 0);
    if (d.referenceNumber && c.referenceNumber && d.referenceNumber === c.referenceNumber) {
      evidence.push(`Matching reference number ${d.referenceNumber}`);
      confidence += 15;
    }
    if (TRANSFER.test(d.description) && TRANSFER.test(c.description)) {
      evidence.push("Both narrations indicate an electronic transfer");
      confidence += 5;
    }
    candidates.push({ matchType, sourceIds: [d.id], targetIds: [c.id], amount: d.debit, dateGapDays: gap, confidence: Math.min(98, confidence), evidence });
    taken.add(d.id);
    taken.add(c.id);
    return true;
  };

  // 1. Own-account transfers: debit and credit in two different accounts of the subject.
  for (const d of debits) {
    if (!isSelf(d)) continue;
    for (const c of credits) {
      if (c.bankAccountId === d.bankAccountId || !isSelf(c)) continue;
      if (tryPair(d, c, "own_account_transfer", 3, 60, ["Debit and credit are in two accounts held by the subject"])) break;
    }
  }
  // 2. Family transfers: subject's account to a spouse/family account (or the reverse).
  for (const d of debits) {
    for (const c of credits) {
      if (c.bankAccountId === d.bankAccountId) continue;
      const pair = (isSelf(d) && isFamily(c)) || (isFamily(d) && isSelf(c));
      if (!pair) continue;
      if (tryPair(d, c, "family_transfer", 3, 55, ["Movement between the subject's account and a family member's account"])) break;
    }
  }
  // 3. Cash withdrawn and re-deposited within 30 days.
  for (const d of debits) {
    if (!(d.category === "cash_withdrawal" || CASH_OUT.test(d.description))) continue;
    for (const c of credits) {
      if (!(c.category === "cash_deposit" || CASH_IN.test(c.description))) continue;
      if (tryPair(d, c, "cash_withdrawal_redeposit", 30, 40, ["Cash withdrawal followed by a cash deposit of the same amount"])) break;
    }
  }
  // 4. Possible duplicate credits: same account, amount, date and narration.
  for (let i = 0; i < credits.length; i++) {
    const a = credits[i]!;
    if (taken.has(a.id)) continue;
    for (let j = i + 1; j < credits.length; j++) {
      const b = credits[j]!;
      if (b.txnDate !== a.txnDate) break;
      if (taken.has(b.id) || b.bankAccountId !== a.bankAccountId || Math.abs(a.credit - b.credit) > 0.009) continue;
      if (a.description.trim().toUpperCase() !== b.description.trim().toUpperCase()) continue;
      if (rejectedKeys.has(`${a.id}|${b.id}`)) continue;
      candidates.push({
        matchType: "duplicate_credit",
        sourceIds: [a.id],
        targetIds: [b.id],
        amount: a.credit,
        dateGapDays: 0,
        confidence: 50,
        evidence: ["Same account, date, amount and narration", "May be a genuine repeat credit or a statement duplicate — needs review"],
      });
      taken.add(a.id);
      taken.add(b.id);
      break;
    }
  }

  if (candidates.length > 0) {
    await db.insert(transactionMatchesTable).values(
      candidates.map((c) => ({ caseId, ...c, amount: round2(c.amount), status: "suggested", createdBy: "engine" })),
    );
  }
  await recomputeReconciliationStatus(caseId);
  return candidates.length;
}

/** Derives each transaction's reconciliation status from the matches it belongs to. */
export async function recomputeReconciliationStatus(caseId: number): Promise<void> {
  const matches = await db.select().from(transactionMatchesTable).where(eq(transactionMatchesTable.caseId, caseId));
  const status = new Map<number, string>();
  const rank: Record<string, number> = { unreconciled: 0, manual_review: 1, partially_reconciled: 2, reconciled: 3 };
  for (const m of matches) {
    const s =
      m.status === "approved" ? "reconciled" : m.status === "partial" ? "partially_reconciled" : m.status === "suggested" ? "manual_review" : "unreconciled";
    for (const id of [...m.sourceIds, ...m.targetIds]) {
      const prev = status.get(id) ?? "unreconciled";
      if (rank[s]! > rank[prev]!) status.set(id, s);
    }
  }
  await db.update(transactionsTable).set({ reconciliationStatus: "unreconciled" }).where(eq(transactionsTable.caseId, caseId));
  const groups = new Map<string, number[]>();
  for (const [id, s] of status) {
    if (s === "unreconciled") continue;
    groups.set(s, [...(groups.get(s) ?? []), id]);
  }
  for (const [s, ids] of groups) {
    await db.update(transactionsTable).set({ reconciliationStatus: s }).where(inArray(transactionsTable.id, ids));
  }
}

/** Transaction ids that approved matches exclude from income/expenditure (prevents double counting). */
export async function excludedTransferIds(caseId: number): Promise<Set<number>> {
  const matches = await db
    .select()
    .from(transactionMatchesTable)
    .where(and(eq(transactionMatchesTable.caseId, caseId), eq(transactionMatchesTable.status, "approved")));
  const ids = new Set<number>();
  for (const m of matches) {
    if (m.matchType === "own_account_transfer" || m.matchType === "cash_withdrawal_redeposit") {
      for (const id of [...m.sourceIds, ...m.targetIds]) ids.add(id);
    }
    if (m.matchType === "duplicate_credit") for (const id of m.targetIds) ids.add(id);
  }
  return ids;
}
