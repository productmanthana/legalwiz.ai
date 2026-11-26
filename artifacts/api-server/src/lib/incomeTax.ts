import { eq } from "drizzle-orm";
import { db, transactionsTable, taxDeclarationsTable } from "@workspace/db";
import { INCOME_CATEGORIES, RECEIPT_CATEGORIES, formatINR, round2 } from "./finance";
import { excludedTransferIds } from "./reconcile";

export const TAX_SOURCES = ["itr", "ais", "tis", "form_26as", "form_16"] as const;
export const TAX_HEADS = ["salary", "house_property", "business_profession", "capital_gains", "other_sources", "exempt_income"] as const;
type Source = (typeof TAX_SOURCES)[number];

/** Approved transaction categories that correspond to an Income Tax head. Anything else is not mapped. */
export const CATEGORY_TO_HEAD: Record<string, (typeof TAX_HEADS)[number]> = {
  salary: "salary",
  rental_income: "house_property",
  business_income: "business_profession",
  agricultural_income: "exempt_income",
};

/** Differences at or below this amount (₹) are treated as rounding. */
export const THRESHOLD = 100;

/** "2019-20" -> "2020-21" */
export function assessmentYearOf(fy: string): string {
  const start = parseInt(fy.slice(0, 4), 10) + 1;
  return `${start}-${String((start + 1) % 100).padStart(2, "0")}`;
}

export function withAssessmentYear<T extends { financialYear: string }>(d: T): T & { assessmentYear: string } {
  return { ...d, assessmentYear: assessmentYearOf(d.financialYear) };
}

type Txn = { id: number; credit: number; category: string | null; financialYear: string };
type Decl = { financialYear: string; source: string; head: string; amount: number };

/** Pure calculation so it can be tested without a database. */
export function compareIncomeTax(txns: Txn[], decls: Decl[], excluded: Set<number>) {
  const years = new Set<string>();
  for (const t of txns) if (t.credit > 0) years.add(t.financialYear);
  for (const d of decls) years.add(d.financialYear);

  const result = [...years].sort().map((fy) => {
    const credits = txns.filter((t) => t.financialYear === fy && t.credit > 0);
    let totalCredits = 0, incomeCredits = 0, receiptCredits = 0, unclassifiedCredits = 0, excludedTransfers = 0;
    const bankByHead = new Map<string, { amount: number; ids: number[] }>();
    for (const t of credits) {
      if (excluded.has(t.id)) {
        excludedTransfers += t.credit;
        continue;
      }
      totalCredits += t.credit;
      if (!t.category) unclassifiedCredits += t.credit;
      else if (INCOME_CATEGORIES.has(t.category)) incomeCredits += t.credit;
      else if (RECEIPT_CATEGORIES.has(t.category)) receiptCredits += t.credit;
      const head = t.category ? CATEGORY_TO_HEAD[t.category] : undefined;
      if (head) {
        const h = bankByHead.get(head) ?? { amount: 0, ids: [] };
        h.amount += t.credit;
        h.ids.push(t.id);
        bankByHead.set(head, h);
      }
    }

    const yearDecls = decls.filter((d) => d.financialYear === fy);
    const reportedFor = (head: string) => {
      const r = {} as Record<Source, number | null>;
      for (const s of TAX_SOURCES) {
        const rows = yearDecls.filter((d) => d.head === head && d.source === s);
        r[s] = rows.length ? round2(rows.reduce((a, d) => a + d.amount, 0)) : null;
      }
      return r;
    };

    const observations: string[] = [];
    const heads = TAX_HEADS.map((head) => {
      const bank = round2(bankByHead.get(head)?.amount ?? 0);
      const reported = reportedFor(head);
      const third = reported.ais ?? reported.form_26as;
      const bankVsItr = reported.itr === null ? null : round2(bank - reported.itr);
      const aisVsItr = reported.itr === null || third === null ? null : round2(third - reported.itr);
      const hasData = bank > 0 || Object.values(reported).some((v) => v !== null);
      const status = !hasData ? "no_data" : reported.itr === null ? "itr_missing"
        : Math.abs(bankVsItr ?? 0) > THRESHOLD || Math.abs(aisVsItr ?? 0) > THRESHOLD ? "difference" : "consistent";
      const label = head.replace(/_/g, " ");
      if (bankVsItr !== null && Math.abs(bankVsItr) > THRESHOLD) {
        observations.push(`${label}: approved bank credits are ₹${formatINR(Math.abs(bankVsItr))} ${bankVsItr > 0 ? "higher" : "lower"} than the ITR figure. Timing, gross/net (TDS, deductions) and accounts not yet uploaded can explain differences.`);
      }
      if (aisVsItr !== null && Math.abs(aisVsItr) > THRESHOLD) {
        observations.push(`${label}: ${reported.ais !== null ? "AIS" : "Form 26AS"} reports ₹${formatINR(Math.abs(aisVsItr))} ${aisVsItr > 0 ? "more" : "less"} than the ITR.`);
      }
      if (reported.itr === null && bank > THRESHOLD) observations.push(`${label}: bank credits of ₹${formatINR(bank)} are classified under this head but no ITR figure is recorded for the year.`);
      return { head, bankCredits: bank, reported, bankVsItr, aisVsItr, status, transactionIds: bankByHead.get(head)?.ids ?? [] };
    });

    const itrRows = yearDecls.filter((d) => d.source === "itr" && d.head !== "exempt_income");
    if (unclassifiedCredits > 0) observations.push(`₹${formatINR(unclassifiedCredits)} of credits are not yet classified and are not mapped to any head.`);
    if (!yearDecls.length) observations.push("No tax records have been entered for this year.");

    return {
      financialYear: fy,
      assessmentYear: assessmentYearOf(fy),
      heads,
      totalCredits: round2(totalCredits),
      incomeCredits: round2(incomeCredits),
      receiptCredits: round2(receiptCredits),
      unclassifiedCredits: round2(unclassifiedCredits),
      excludedTransfers: round2(excludedTransfers),
      declaredIncome: itrRows.length ? round2(itrRows.reduce((a, d) => a + d.amount, 0)) : null,
      observations,
    };
  });

  return {
    years: result,
    threshold: THRESHOLD,
    notes: [
      "Bank credits are mapped to a head only when the transaction category has been approved: salary → Salary, rental income → House property, business income → Business/profession, agricultural income → Exempt income.",
      "Loans, gifts, sale proceeds and other receipts are shown separately and are not income.",
      "Approved own-account transfers and duplicate credits are excluded so the same money is not counted twice.",
      "Tax-record figures are as entered by users from the uploaded documents; check them against the originals.",
    ],
    disclaimer: "This comparison lists arithmetic differences for review. It does not decide whether income was under-reported or whether any explanation is valid.",
  };
}

export async function incomeTaxComparison(caseId: number) {
  const [txns, decls, excluded] = await Promise.all([
    db.select().from(transactionsTable).where(eq(transactionsTable.caseId, caseId)),
    db.select().from(taxDeclarationsTable).where(eq(taxDeclarationsTable.caseId, caseId)),
    excludedTransferIds(caseId),
  ]);
  return compareIncomeTax(txns, decls, excluded);
}
