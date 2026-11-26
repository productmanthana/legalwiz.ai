import { eq } from "drizzle-orm";
import {
  db,
  casesTable,
  investigationPeriodsTable,
  familyMembersTable,
  bankAccountsTable,
  bankStatementsTable,
  transactionsTable,
  assetsTable,
  liabilitiesTable,
  ledgerEntriesTable,
  investigationQueriesTable,
  legalReferencesTable,
  type User,
} from "@workspace/db";
import { financialYearOf, round2 } from "./finance";
import { dedupeKeyFor } from "./statementImport";

/**
 * Seeds the global legal library with *unverified* entries. Only titles, provisions and issue tags
 * are recorded. No dates, citations, paragraph numbers or holdings are entered — users must verify
 * each reference against an official source and record the details themselves.
 */
export async function seedLegalLibrary(): Promise<void> {
  const refs: (typeof legalReferencesTable.$inferInsert)[] = [
    { sourceType: "statute", title: "Prevention of Corruption Act, 1988 — Section 13(1)(e) (as it stood before the 2018 amendment)", provision: "Section 13(1)(e)", categories: ["disproportionate_assets", "statute"], legalIssue: "Criminal misconduct by possession of assets disproportionate to known sources of income (pre-amendment wording)." },
    { sourceType: "statute", title: "Prevention of Corruption Act, 1988 — Section 13(1)(b) (after the 2018 amendment)", provision: "Section 13(1)(b)", categories: ["disproportionate_assets", "statute"], legalIssue: "Illicit enrichment / disproportionate assets provision following the 2018 amendment." },
    { sourceType: "statute", title: "Karnataka Lokayukta Act, 1984", provision: null, categories: ["lokayukta", "statute"], legalIssue: "Constitution, powers and procedure of the Karnataka Lokayukta." },
    { sourceType: "statute", title: "Income-tax Act, 1961 — Section 68 (cash credits)", provision: "Section 68", categories: ["income_tax", "unexplained_credits"], legalIssue: "Sums credited in the books whose nature and source are not satisfactorily explained." },
    { sourceType: "statute", title: "Income-tax Act, 1961 — Section 69 (unexplained investments)", provision: "Section 69", categories: ["income_tax", "unexplained_investments"], legalIssue: "Investments not recorded in the books whose source is not satisfactorily explained." },
    { sourceType: "statute", title: "Income-tax Act, 1961 — Section 69A (unexplained money, bullion, jewellery)", provision: "Section 69A", categories: ["income_tax", "unexplained_assets"], legalIssue: "Money, bullion, jewellery or valuables whose ownership or source is not satisfactorily explained." },
    { sourceType: "statute", title: "Income-tax Act, 1961 — Section 69C (unexplained expenditure)", provision: "Section 69C", categories: ["income_tax", "unexplained_expenditure"], legalIssue: "Expenditure whose source is not satisfactorily explained." },
    { sourceType: "statute", title: "Income-tax Act, 1961 — Section 143(3) (scrutiny assessment)", provision: "Section 143(3)", categories: ["income_tax", "scrutiny"], legalIssue: "Assessment after scrutiny of the return." },
    { sourceType: "judgment", title: "State of Maharashtra v. Wasudeo Ramchandra Kaidalwar", court: "Supreme Court of India", categories: ["disproportionate_assets", "burden_of_proof"], legalIssue: "Indicative tag: burden of proof in disproportionate assets cases. Verify before reliance." },
    { sourceType: "judgment", title: "K. Veeraswami v. Union of India", court: "Supreme Court of India", categories: ["disproportionate_assets", "public_servant"], legalIssue: "Indicative tag: disproportionate assets and the meaning of known sources of income. Verify before reliance." },
    { sourceType: "judgment", title: "P. Nallammal v. State (rep. by Inspector of Police) / DSP, Chennai v. K. Inbasagaran", court: "Supreme Court of India", categories: ["disproportionate_assets", "family_assets"], legalIssue: "Indicative tag: assets held in the names of family members. Verify the exact case and citation before reliance." },
    { sourceType: "judgment", title: "State of Karnataka v. Selvi J. Jayalalitha", court: "Supreme Court of India", categories: ["disproportionate_assets", "computation"], legalIssue: "Indicative tag: computation of disproportionate assets and treatment of income and loans. Verify before reliance." },
    { sourceType: "judgment", title: "Krishnanand Agnihotri v. State of Madhya Pradesh", court: "Supreme Court of India", categories: ["disproportionate_assets", "margin"], legalIssue: "Indicative tag: whether a comparatively small excess is treated as disproportionate. Verify before reliance." },
  ];
  const existing = await db.select({ title: legalReferencesTable.title }).from(legalReferencesTable);
  const have = new Set(existing.map((e) => e.title));
  const missing = refs.filter((r) => !have.has(r.title));
  if (missing.length) {
    await db.insert(legalReferencesTable).values(
      missing.map((r) => ({ ...r, verificationStatus: "unverified", bindingStatus: "not_assessed", verificationNote: "Seeded entry. Not verified. Confirm the text, citation and date from an official source before relying on it." })),
    );
  }
}

/** Deterministic pseudo-random generator so the demo is identical every time. */
function rng(seed: number) {
  let s = seed;
  return () => {
    s = (s * 1103515245 + 12345) % 2147483648;
    return s / 2147483648;
  };
}

type T = { date: string; desc: string; debit?: number; credit?: number; ref?: string; category?: string };

export async function seedDemoCase(user: User) {
  await seedLegalLibrary();
  const [c] = await db
    .insert(casesTable)
    .values({
      ownerId: user.id,
      title: "DEMO — R. Prakash (fictitious) DA enquiry",
      referenceNumber: "DEMO/LOK/0001",
      caseType: "lokayukta_da",
      investigatingAuthority: "Karnataka Lokayukta (demo)",
      jurisdiction: "Mysuru (demo)",
      subjectName: "R. Prakash (fictitious person)",
      periodStart: "2014-04-01",
      periodEnd: "2020-03-31",
      noticeDate: "2021-02-15",
      noticeDetails: "Fictitious notice for demonstration. All names, accounts and figures in this case are invented.",
      status: "in_progress",
      legislation: "Prevention of Corruption Act, 1988 (demo)",
      submissionDeadline: new Date(Date.now() + 21 * 86400000).toISOString().slice(0, 10),
      isDemo: true,
    })
    .returning();
  const caseId = c!.id;
  await db.insert(investigationPeriodsTable).values([
    { caseId, label: "Check period", startDate: "2014-04-01", endDate: "2020-03-31", periodType: "check_period" },
  ]);
  const [spouse] = await db
    .insert(familyMembersTable)
    .values({ caseId, name: "Lakshmi Prakash", relationship: "spouse", occupation: "Government school teacher", employer: "Dept. of School Education (demo)", hasIndependentIncome: true, annualIncomeDeclared: 360000, notes: "Fictitious family member." })
    .returning();
  await db.insert(familyMembersTable).values({ caseId, name: "Arjun Prakash", relationship: "son", occupation: "Student", hasIndependentIncome: false });

  const [sbi, canara] = await db
    .insert(bankAccountsTable)
    .values([
      { caseId, bankName: "State Bank of India (demo)", accountHolder: "R. Prakash", accountType: "savings", maskedAccountNumber: "XXXX4821", ifsc: "SBIN0000000", branch: "Mysuru Main (demo)", ownership: "self" },
      { caseId, bankName: "Canara Bank (demo)", accountHolder: "R. Prakash", accountType: "savings", maskedAccountNumber: "XXXX0937", ifsc: "CNRB0000000", branch: "Saraswathipuram (demo)", ownership: "self" },
    ])
    .returning();

  const r = rng(42);
  const sbiT: T[] = [];
  const canT: T[] = [];
  const pad = (n: number) => String(n).padStart(2, "0");
  sbiT.push({ date: "2014-03-31", desc: "BY SALARY FOR MAR 2014 DEPT OF PWD", credit: 48000 });
  canT.push({ date: "2014-03-20", desc: "BY CLG CHQ 004512 DEPOSIT", credit: 65000 });
  for (let y = 2014; y <= 2020; y++) {
    for (let m = 1; m <= 12; m++) {
      const d = `${y}-${pad(m)}`;
      if (d < "2014-04" || d > "2020-03") continue;
      const fyIndex = y - 2014 + (m >= 4 ? 0 : -1);
      const salary = round2(48000 * Math.pow(1.07, Math.max(0, fyIndex)));
      sbiT.push({ date: `${d}-01`, desc: `BY SALARY FOR ${["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"][m === 1 ? 11 : m - 2]} DEPT OF PWD`, credit: salary, category: "salary" });
      sbiT.push({ date: `${d}-05`, desc: "ATM WDL MYSURU KR CIRCLE", debit: 10000 + Math.round(r() * 4) * 2500 });
      sbiT.push({ date: `${d}-12`, desc: "POS GROCERY MORE SUPERMARKET", debit: round2(3000 + r() * 4000) });
      sbiT.push({ date: `${d}-18`, desc: "BESCOM ELECTRICITY BILL PAY", debit: round2(900 + r() * 900) });
      if (d >= "2016-08") canT.push({ date: `${d}-10`, desc: "HL EMI RECOVERY LOAN A/C 7781", debit: 16850, category: "loan_repayment" });
      if (m % 3 === 0) {
        const amt = 15000 + Math.round(r() * 3) * 5000;
        sbiT.push({ date: `${d}-20`, desc: "TO TRF SELF CANARA XXXX0937 NEFT", debit: amt, ref: `N${y}${pad(m)}20A` });
        canT.push({ date: `${d}-21`, desc: "BY NEFT FROM SELF SBI XXXX4821", credit: amt, ref: `N${y}${pad(m)}20A` });
      }
      if (m === 6) sbiT.push({ date: `${d}-15`, desc: "LIC PREMIUM POLICY 61234", debit: 24500 });
      if (m === 6 && y >= 2017) sbiT.push({ date: `${d}-25`, desc: "SCHOOL FEES ST JOSEPHS", debit: 45000 + (y - 2017) * 5000 });
    }
  }
  // Notable one-off items.
  canT.push({ date: "2015-09-08", desc: "BY CASH DEPOSIT BRANCH", credit: 300000 });
  canT.push({ date: "2015-09-14", desc: "SUB-REGISTRAR MYSURU STAMP DUTY PLOT", debit: 126000 });
  canT.push({ date: "2015-09-14", desc: "TO RTGS SITE PURCHASE V NAGARAJ", debit: 1800000 - 1500000 });
  canT.push({ date: "2016-06-12", desc: "LOAN DISB HOUSING LOAN A/C 7781", credit: 1500000 });
  canT.push({ date: "2016-06-13", desc: "TO RTGS BUILDER SRI SAI CONSTRUCTIONS", debit: 1450000 });
  sbiT.push({ date: "2017-11-04", desc: "BY CASH DEPOSIT CDM", credit: 200000 });
  sbiT.push({ date: "2017-11-06", desc: "TO PURCHASE BHIMA JEWELLERS", debit: 380000 });
  sbiT.push({ date: "2018-02-19", desc: "BY TRF FROM LAKSHMI PRAKASH", credit: 150000 });
  sbiT.push({ date: "2018-05-22", desc: "BY NEFT MANJUNATH ENTERPRISES", credit: 500000 });
  sbiT.push({ date: "2018-08-30", desc: "TO RTGS NEXA MOTORS CAR", debit: 750000 });
  canT.push({ date: "2019-01-15", desc: "BY RENT RECEIVED K SURESH", credit: 60000 });
  canT.push({ date: "2019-07-03", desc: "BY GIFT FROM FATHER H RAMAIAH", credit: 250000 });
  canT.push({ date: "2019-12-10", desc: "BY CASH DEPOSIT BRANCH", credit: 150000 });

  const insertAccount = async (acctId: number, list: T[], opening: number, fileName: string) => {
    list.sort((a, b) => a.date.localeCompare(b.date));
    const [stmt] = await db
      .insert(bankStatementsTable)
      .values({ caseId, bankAccountId: acctId, fileName, fileType: "csv", fileHash: `demo-${acctId}`, status: "imported", periodStart: list[0]!.date, periodEnd: list[list.length - 1]!.date, rowsImported: list.length, balanceCheckStatus: "passed", warnings: ["Demo data — generated, not a real statement."] })
      .returning();
    let bal = opening;
    const rows = list.map((t, i) => {
      const debit = round2(t.debit ?? 0);
      const credit = round2(t.credit ?? 0);
      bal = round2(bal + credit - debit);
      const base = { txnDate: t.date, valueDate: t.date, description: t.desc, referenceNumber: t.ref ?? null, debit, credit, balance: bal };
      return {
        caseId,
        bankAccountId: acctId,
        statementId: stmt!.id,
        sourceRow: i + 2,
        ...base,
        origDescription: t.desc,
        origDebit: debit,
        origCredit: credit,
        origTxnDate: t.date,
        origBalance: bal,
        financialYear: financialYearOf(t.date),
        dedupeKey: dedupeKeyFor(base),
        category: t.category ?? null,
        classificationStatus: t.category ? "approved" : "unclassified",
      };
    });
    for (let i = 0; i < rows.length; i += 500) await db.insert(transactionsTable).values(rows.slice(i, i + 500));
  };
  await insertAccount(sbi!.id, sbiT, 85000, "demo-sbi-4821.csv");
  await insertAccount(canara!.id, canT, 120000, "demo-canara-0937.csv");

  const [loan] = await db
    .insert(liabilitiesTable)
    .values({ caseId, liabilityType: "housing_loan", lender: "Canara Bank (demo)", borrower: "R. Prakash", ownership: "self", sanctionDate: "2016-06-10", principalAmount: 1500000, outstandingAtStart: 0, outstandingAtEnd: 1180000, interestRate: 8.65, purpose: "Construction of house on Vijayanagar plot" })
    .returning();
  await db.insert(assetsTable).values([
    { caseId, assetType: "fixed_deposit", description: "SBI fixed deposit (demo)", acquisitionDate: "2013-11-02", purchasePrice: 200000, ownership: "self", sourceOfFunds: "Salary savings", valuationBasis: "Cost" },
    { caseId, assetType: "land", description: "Residential plot, Vijayanagar 2nd Stage, Mysuru (demo)", acquisitionDate: "2015-09-14", purchasePrice: 1800000, registrationCost: 126000, ownership: "self", legalOwner: "R. Prakash", sourceOfFunds: "Savings and cash deposit of Rs. 3,00,000", valuationBasis: "Sale deed value" },
    { caseId, assetType: "building", description: "House construction on Vijayanagar plot (demo)", acquisitionDate: "2017-03-31", purchasePrice: 2350000, ownership: "self", legalOwner: "R. Prakash", sourceOfFunds: "Housing loan and savings", linkedLiabilityId: loan!.id, valuationBasis: "Builder invoices" },
    { caseId, assetType: "gold_jewellery", description: "Gold jewellery purchased from Bhima Jewellers (demo)", acquisitionDate: "2017-11-06", purchasePrice: 380000, ownership: "joint", ownershipSharePercent: 50, legalOwner: "R. Prakash and Lakshmi Prakash" },
    { caseId, assetType: "vehicle", description: "Maruti Ciaz car KA-09-XX-0000 (demo)", acquisitionDate: "2018-08-30", purchasePrice: 750000, ownership: "self", sourceOfFunds: null },
    { caseId, assetType: "land", description: "Site at Bogadi, Mysuru in spouse's name (demo)", acquisitionDate: "2019-10-21", purchasePrice: 900000, registrationCost: 63000, ownership: "spouse", familyMemberId: spouse!.id, legalOwner: "Lakshmi Prakash", sourceOfFunds: "Spouse's salary savings (claimed)" },
  ]);
  const ledger: (typeof ledgerEntriesTable.$inferInsert)[] = [];
  for (let y = 2014; y <= 2019; y++) {
    ledger.push({ caseId, entryType: "income", category: "agricultural_income", description: "Arecanut sale from ancestral land, Hunsur (as stated)", amount: 120000 + (y - 2014) * 10000, entryDate: `${y + 1}-02-28`, financialYear: financialYearOf(`${y + 1}-02-28`), verificationStatus: "user_provided", sourceReference: "No RTC or APMC records uploaded yet" });
    ledger.push({ caseId, entryType: "income", category: "salary", description: "Spouse salary (annual, as per Form 16)", amount: 300000 + (y - 2014) * 15000, entryDate: `${y + 1}-03-31`, financialYear: financialYearOf(`${y + 1}-03-31`), familyMemberId: spouse!.id, verificationStatus: "documented" });
  }
  await db.insert(ledgerEntriesTable).values(ledger);

  const txns = await db.select().from(transactionsTable).where(eq(transactionsTable.caseId, caseId));
  const find = (s: string) => txns.filter((t) => t.description.includes(s)).map((t) => t.id);
  await db.insert(investigationQueriesTable).values([
    { caseId, questionNumber: "1", subject: "Source of cash deposits", description: "Explain the source of the cash deposits of Rs. 3,00,000 on 08-09-2015, Rs. 2,00,000 on 04-11-2017 and Rs. 1,50,000 on 10-12-2019, with supporting documents.", topic: "cash_deposits", relatedTransactionIds: find("CASH DEPOSIT"), responseDeadline: new Date(Date.now() + 14 * 86400000).toISOString().slice(0, 10), raisedBy: "Investigating officer (demo)" },
    { caseId, questionNumber: "2", subject: "Credit from Manjunath Enterprises", description: "Explain the nature of the credit of Rs. 5,00,000 received on 22-05-2018 from Manjunath Enterprises and furnish documentary evidence.", topic: "bank_credits", relatedTransactionIds: find("MANJUNATH"), responseDeadline: new Date(Date.now() + 14 * 86400000).toISOString().slice(0, 10), raisedBy: "Investigating officer (demo)" },
  ]);
  return c!;
}
