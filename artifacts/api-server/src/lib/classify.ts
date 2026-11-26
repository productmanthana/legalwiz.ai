type Rule = { re: RegExp; dir: "credit" | "debit" | "any"; category: string; reason: string };

/**
 * Deterministic keyword rules. Output is only ever a *suggestion* — it is stored in
 * suggestedCategory and requires explicit user approval before it affects any schedule.
 */
const RULES: Rule[] = [
  { re: /\b(SALARY|SAL CR|SAL FOR|PAYROLL|SALARY CREDIT)\b/i, dir: "credit", category: "salary", reason: "Narration contains a salary keyword" },
  { re: /\b(SELF|OWN A\/?C|TRF TO SELF|TO SELF|FROM SELF)\b/i, dir: "any", category: "own_account_transfer", reason: "Narration indicates a transfer between the holder's own accounts" },
  { re: /\b(ATM|ATW|CASH WDL|CASH WITHDRAWAL|NWD|CASH-WDL|CSH WDL)\b/i, dir: "debit", category: "cash_withdrawal", reason: "Narration indicates a cash withdrawal" },
  { re: /\b(CASH DEP|BY CASH|CASH DEPOSIT|CDM|CASH-DEP)\b/i, dir: "credit", category: "cash_deposit", reason: "Narration indicates a cash deposit" },
  { re: /\b(LOAN DISB|DISBURSEMENT|LOAN A\/?C DISB)\b/i, dir: "credit", category: "bank_loan", reason: "Narration indicates a loan disbursement" },
  { re: /\b(EMI|LOAN REPAY|LOAN RECOVERY|HL EMI|LOAN INSTAL)\b/i, dir: "debit", category: "loan_repayment", reason: "Narration indicates a loan instalment" },
  { re: /\b(RENT)\b/i, dir: "credit", category: "rental_income", reason: "Credit narration mentions rent" },
  { re: /\b(AGRI|CROP|ARECANUT|COFFEE SALE|APMC)\b/i, dir: "credit", category: "agricultural_income", reason: "Narration contains an agricultural keyword" },
  { re: /\b(LIC|INSURANCE|PREMIUM)\b/i, dir: "debit", category: "insurance", reason: "Narration mentions insurance or premium" },
  { re: /\b(MUTUAL FUND|MF |SIP|ZERODHA|NSDL|CDSL|FD BOOKED|TERM DEPOSIT|PPF|NSC)\b/i, dir: "debit", category: "investment", reason: "Narration indicates an investment" },
  { re: /\b(MUTUAL FUND|REDEMPTION|FD CLOSURE|FD MATURITY|MATURITY PROCEEDS)\b/i, dir: "credit", category: "investment_redemption", reason: "Narration indicates redemption or maturity" },
  { re: /\b(ADVANCE TAX|TDS|INCOME TAX|CBDT|SELF ASSESSMENT TAX|ITNS)\b/i, dir: "debit", category: "tax_payment", reason: "Narration indicates a tax payment" },
  { re: /\b(SCHOOL|COLLEGE|UNIVERSITY|TUITION|FEES)\b/i, dir: "debit", category: "education_expenditure", reason: "Narration mentions an educational institution or fees" },
  { re: /\b(HOSPITAL|CLINIC|PHARMA|MEDICAL|DIAGNOSTIC)\b/i, dir: "debit", category: "medical_expenditure", reason: "Narration mentions medical services" },
  { re: /\b(SUB-?REGISTRAR|STAMP DUTY|REGISTRATION FEE|PLOT|SITE PURCHASE|PROPERTY)\b/i, dir: "debit", category: "property_purchase", reason: "Narration indicates a property-related payment" },
  { re: /\b(GROCERY|SUPERMARKET|ELECTRICITY|BESCOM|BWSSB|GAS|MOBILE BILL|DTH|POS)\b/i, dir: "debit", category: "household_expenditure", reason: "Narration indicates routine household spending" },
  { re: /\b(GIFT)\b/i, dir: "credit", category: "gift", reason: "Narration mentions a gift" },
];

export function suggestCategory(
  description: string,
  debit: number,
  credit: number,
  familyNames: string[],
): { category: string; reason: string } | null {
  const dir = credit > 0 ? "credit" : "debit";
  for (const r of RULES) {
    if ((r.dir === "any" || r.dir === dir) && r.re.test(description)) return { category: r.category, reason: r.reason };
  }
  const upper = description.toUpperCase();
  for (const name of familyNames) {
    const parts = name.toUpperCase().split(/\s+/).filter((p) => p.length >= 4);
    if (parts.some((p) => upper.includes(p))) {
      return { category: "family_transfer", reason: `Narration contains the name of family member "${name}"` };
    }
  }
  return null;
}
