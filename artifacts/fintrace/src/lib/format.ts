import { format, parseISO, isValid } from "date-fns";

const inrFmt = new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", minimumFractionDigits: 2, maximumFractionDigits: 2 });
const inrWhole = new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 });
const numFmt = new Intl.NumberFormat("en-IN");

export function inr(v: number | null | undefined, whole = false): string {
  if (v === null || v === undefined || Number.isNaN(v)) return "—";
  return whole ? inrWhole.format(v) : inrFmt.format(v);
}

export function inrCompact(v: number | null | undefined): string {
  if (v === null || v === undefined) return "—";
  const a = Math.abs(v);
  const s = v < 0 ? "-" : "";
  if (a >= 1e7) return `${s}₹${(a / 1e7).toFixed(2)} Cr`;
  if (a >= 1e5) return `${s}₹${(a / 1e5).toFixed(2)} L`;
  return inrWhole.format(v);
}

export function n(v: number | null | undefined): string {
  if (v === null || v === undefined) return "—";
  return numFmt.format(v);
}

export function fdate(v: string | null | undefined): string {
  if (!v) return "—";
  const d = parseISO(v);
  return isValid(d) ? format(d, "dd MMM yyyy") : v;
}

export function fdatetime(v: string | null | undefined): string {
  if (!v) return "—";
  const d = parseISO(v);
  return isValid(d) ? format(d, "dd MMM yyyy, HH:mm") : v;
}

export function human(v: string | null | undefined): string {
  if (!v) return "—";
  const s = v.replace(/_/g, " ");
  return s.charAt(0).toUpperCase() + s.slice(1);
}

export const CASE_TYPES: Record<string, string> = {
  lokayukta_da: "Karnataka Lokayukta DA Investigation",
  income_tax_scrutiny: "Income Tax Scrutiny",
  income_tax_assessment: "Income Tax Assessment",
  other_financial: "Other Financial Investigation",
  custom: "Custom Investigation",
};

export const CASE_STATUSES = ["open", "under_preparation", "submitted", "under_review", "closed"];

export const TXN_CATEGORIES = [
  "salary", "business_income", "rental_income", "agricultural_income", "bank_loan", "personal_loan", "gift", "inheritance",
  "property_sale", "investment_redemption", "cash_deposit", "cash_withdrawal", "own_account_transfer", "family_transfer",
  "property_purchase", "household_expenditure", "education_expenditure", "medical_expenditure", "loan_repayment", "investment",
  "insurance", "tax_payment", "other",
];

export const DOC_CATEGORIES = [
  "bank_statement", "itr", "ais_tis", "form_16", "salary_slip", "loan_document", "property_deed", "registration_receipt",
  "valuation_report", "gift_deed", "inheritance_document", "investment_statement", "insurance_record", "notice", "legal_judgment", "affidavit", "other",
];

export const LEGAL_CATEGORIES = [
  "disproportionate_assets", "source_of_income", "spouse_income", "family_assets", "gifts", "inheritance", "loans", "bank_deposits",
  "property_valuation", "investigation_procedure", "preliminary_enquiry", "criminal_proceedings", "income_tax_scrutiny",
];

export const QUERY_TOPICS = ["bank_credits", "cash_deposits", "assets", "property_acquisition", "income_sources", "expenditure", "loans", "family_transactions", "investments", "gifts", "liabilities", "tax_returns", "other"];
export const QUERY_STATUSES = ["open", "draft", "submitted", "under_review", "clarification_required", "partially_addressed", "reviewed", "closed"];
export const MATCH_TYPES = ["own_account_transfer", "family_transfer", "cash_withdrawal_redeposit", "duplicate_credit", "loan_receipt_repayment", "investment_purchase_redemption", "other"];

export const opts = (arr: string[], labels?: Record<string, string>) => arr.map((v) => ({ value: v, label: labels?.[v] ?? human(v) }));

export function errMsg(e: unknown): string {
  const anyE = e as { data?: { error?: string }; message?: string };
  return anyE?.data?.error ?? anyE?.message ?? "Something went wrong";
}

export function initials(name?: string | null) {
  if (!name) return "FT";
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map((p) => p[0]?.toUpperCase()).join("");
}
