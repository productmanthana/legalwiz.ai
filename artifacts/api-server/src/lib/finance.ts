/** Indian financial year (April-March) label for a YYYY-MM-DD date, e.g. "2019-20". */
export function financialYearOf(date: string): string {
  const y = parseInt(date.slice(0, 4), 10);
  const m = parseInt(date.slice(5, 7), 10);
  const start = m >= 4 ? y : y - 1;
  return `${start}-${String((start + 1) % 100).padStart(2, "0")}`;
}

export function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

export function daysBetween(a: string, b: string): number {
  return Math.round(Math.abs(Date.parse(a) - Date.parse(b)) / 86400000);
}

export function formatINR(n: number): string {
  return new Intl.NumberFormat("en-IN", { maximumFractionDigits: 2, minimumFractionDigits: 2 }).format(n);
}

export const INCOME_CATEGORIES = new Set([
  "salary",
  "business_income",
  "rental_income",
  "agricultural_income",
]);
/** Receipts are money in that is not income (borrowings, transfers, sale proceeds, gifts). */
export const RECEIPT_CATEGORIES = new Set([
  "bank_loan",
  "personal_loan",
  "gift",
  "inheritance",
  "property_sale",
  "investment_redemption",
  "family_transfer",
  "cash_deposit",
]);
export const EXPENDITURE_CATEGORIES = new Set([
  "household_expenditure",
  "education_expenditure",
  "medical_expenditure",
  "loan_repayment",
  "insurance",
  "tax_payment",
]);
/** Outflows that become assets rather than expenditure. */
export const ASSET_OUTFLOW_CATEGORIES = new Set(["property_purchase", "investment"]);
/** Neutral movements excluded from both sides. */
export const NEUTRAL_CATEGORIES = new Set(["own_account_transfer", "cash_withdrawal"]);
