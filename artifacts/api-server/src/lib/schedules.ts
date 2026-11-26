import { and, eq } from "drizzle-orm";
import {
  db,
  transactionsTable,
  ledgerEntriesTable,
  assetsTable,
  liabilitiesTable,
  bankAccountsTable,
  investigationPeriodsTable,
  familyMembersTable,
  documentsTable,
  blindSpotReviewsTable,
  type CaseRow,
} from "@workspace/db";
import {
  INCOME_CATEGORIES,
  RECEIPT_CATEGORIES,
  EXPENDITURE_CATEGORIES,
  formatINR,
  round2,
} from "./finance";
import { excludedTransferIds } from "./reconcile";

type Section = "income" | "receipt" | "expenditure";
type Source = { kind: "transaction" | "ledger_entry" | "asset" | "liability"; id: number; label: string; amount: number; date: string | null };

function periodKey(date: string, fy: string, granularity: string): string {
  if (granularity === "monthly") return date.slice(0, 7);
  if (granularity === "quarterly") {
    const m = parseInt(date.slice(5, 7), 10);
    const q = m >= 4 && m <= 6 ? 1 : m >= 7 && m <= 9 ? 2 : m >= 10 ? 3 : 4;
    return `FY ${fy} Q${q}`;
  }
  return `FY ${fy}`;
}

function sectionForCategory(category: string, credit: number, debit: number): { section: Section; amount: number } | null {
  if (credit > 0 && INCOME_CATEGORIES.has(category)) return { section: "income", amount: credit };
  if (credit > 0 && RECEIPT_CATEGORIES.has(category)) return { section: "receipt", amount: credit };
  if (debit > 0 && EXPENDITURE_CATEGORIES.has(category)) return { section: "expenditure", amount: debit };
  return null;
}

export async function incomeExpenditure(caseId: number, granularity: string) {
  const txns = await db.select().from(transactionsTable).where(eq(transactionsTable.caseId, caseId));
  const entries = await db.select().from(ledgerEntriesTable).where(eq(ledgerEntriesTable.caseId, caseId));
  const excluded = await excludedTransferIds(caseId);

  const periods = new Map<string, Map<string, { section: Section; category: string; amount: number; sources: Source[] }>>();
  const add = (pk: string, section: Section, category: string, src: Source) => {
    if (!periods.has(pk)) periods.set(pk, new Map());
    const lines = periods.get(pk)!;
    const key = `${section}:${category}`;
    if (!lines.has(key)) lines.set(key, { section, category, amount: 0, sources: [] });
    const l = lines.get(key)!;
    l.amount = round2(l.amount + src.amount);
    l.sources.push(src);
  };

  let excludedTransfers = 0;
  let uncategorised = 0;
  let onlySuggested = 0;
  let wrongSide = 0;
  for (const t of txns) {
    if (excluded.has(t.id)) {
      excludedTransfers += Math.max(t.credit, t.debit);
      continue;
    }
    if (!t.category) {
      uncategorised++;
      if (t.suggestedCategory) onlySuggested++;
      continue;
    }
    const s = sectionForCategory(t.category, t.credit, t.debit);
    if (!s) {
      if (INCOME_CATEGORIES.has(t.category) || RECEIPT_CATEGORIES.has(t.category) || EXPENDITURE_CATEGORIES.has(t.category)) wrongSide++;
      continue;
    }
    add(periodKey(t.txnDate, t.financialYear, granularity), s.section, t.category, {
      kind: "transaction",
      id: t.id,
      label: `${t.txnDate} ${t.description}`.slice(0, 140),
      amount: s.amount,
      date: t.txnDate,
    });
  }
  for (const e of entries) {
    add(periodKey(e.entryDate, e.financialYear, granularity), e.entryType as Section, e.category, {
      kind: "ledger_entry",
      id: e.id,
      label: `${e.description ?? e.category} (${e.verificationStatus.replace(/_/g, " ")})`,
      amount: e.amount,
      date: e.entryDate,
    });
  }

  const out = [...periods.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([period, lines]) => {
      const arr = [...lines.values()].sort((a, b) => a.section.localeCompare(b.section) || b.amount - a.amount);
      const sum = (s: Section) => round2(arr.filter((l) => l.section === s).reduce((x, l) => x + l.amount, 0));
      return { period, totalIncome: sum("income"), totalReceipts: sum("receipt"), totalExpenditure: sum("expenditure"), lines: arr };
    });
  const totals = {
    income: round2(out.reduce((s, p) => s + p.totalIncome, 0)),
    receipts: round2(out.reduce((s, p) => s + p.totalReceipts, 0)),
    expenditure: round2(out.reduce((s, p) => s + p.totalExpenditure, 0)),
    excludedTransfers: round2(excludedTransfers),
  };
  const notes = [
    "Only transactions with an approved category are included. AI or rule-based suggestions are not counted until approved.",
    "Receipts (loans, gifts, inheritance, sale proceeds, family transfers, cash deposits) are shown separately from income.",
    "Purchases of property and investments are treated as asset acquisitions, not expenditure.",
  ];
  if (uncategorised > 0) notes.push(`${uncategorised} transaction(s) are not yet categorised and are excluded${onlySuggested ? ` (${onlySuggested} have suggestions awaiting approval)` : ""}.`);
  if (wrongSide > 0) notes.push(`${wrongSide} transaction(s) have a category that does not fit their direction (e.g. an expenditure category on a credit) and are excluded pending review.`);
  if (excludedTransfers > 0) notes.push(`Rs. ${formatINR(excludedTransfers)} of approved own-account transfers, cash re-deposits and duplicate credits were excluded to prevent double counting.`);
  return { granularity, periods: out, totals, notes };
}

const DA_RECEIPTS_IN_C = new Set(["bank_loan", "personal_loan", "gift", "inheritance", "property_sale", "investment_redemption"]);

export async function daCalculation(c: CaseRow, includeFamily: boolean) {
  const caseId = c.id;
  const periods = await db.select().from(investigationPeriodsTable).where(eq(investigationPeriodsTable.caseId, caseId));
  const check = periods.find((p) => p.periodType === "check_period");
  const assumptions: string[] = [];
  const missing: string[] = [];
  let start: string | null = check?.startDate ?? null;
  let end: string | null = check?.endDate ?? null;
  if (!check && c.periodStart && c.periodEnd) {
    start = c.periodStart;
    end = c.periodEnd;
    assumptions.push("No check period is configured; the case investigation period has been used instead.");
  }
  const base = {
    caseId,
    checkPeriodConfigured: !!check,
    checkPeriodStart: start,
    checkPeriodEnd: end,
    includeFamily,
    formula: "Disproportion = (B - A) - (C - D); Percentage = Disproportion / C x 100",
    templateVersion: "KLA-DA-1.0",
    disclaimer:
      "This is an arithmetic working prepared from the records entered in FINTRACE. It is not a finding of disproportionate assets, guilt or liability. Inclusion or exclusion of any item as a known source of income is a matter for the competent authority and the court.",
  };
  if (!start || !end) {
    missing.push("Configure a check period (period type: check period) on the case to compute the DA statement.");
    return {
      ...base,
      components: (["A", "B", "C", "D"] as const).map((code) => ({ code, label: COMPONENT_LABELS[code], amount: 0, lines: [] })),
      assetsAcquired: 0,
      likelySavings: 0,
      disproportion: 0,
      disproportionPercent: null,
      assumptions,
      missingInformation: missing,
    };
  }

  const [assets, liabilities, accounts, txns, entries, family, docs] = await Promise.all([
    db.select().from(assetsTable).where(eq(assetsTable.caseId, caseId)),
    db.select().from(liabilitiesTable).where(eq(liabilitiesTable.caseId, caseId)),
    db.select().from(bankAccountsTable).where(eq(bankAccountsTable.caseId, caseId)),
    db.select().from(transactionsTable).where(eq(transactionsTable.caseId, caseId)),
    db.select().from(ledgerEntriesTable).where(eq(ledgerEntriesTable.caseId, caseId)),
    db.select().from(familyMembersTable).where(eq(familyMembersTable.caseId, caseId)),
    db.select().from(documentsTable).where(and(eq(documentsTable.caseId, caseId), eq(documentsTable.isArchived, false))),
  ]);
  const excluded = await excludedTransferIds(caseId);
  const inScopeOwnership = (o: string) => (includeFamily ? true : o === "self" || o === "joint");
  const scopeAccounts = accounts.filter((a) => inScopeOwnership(a.ownership));
  const scopeAccountIds = new Set(scopeAccounts.map((a) => a.id));
  const familyName = new Map(family.map((f) => [f.id, f.name]));

  assumptions.push(
    "Assets are valued at cost (purchase price plus registration cost) as recorded; current market valuation is not used.",
    "Bank balances are taken from the last imported statement balance on or before each date.",
    "Receipts such as loans, gifts, inheritance, sale proceeds and investment redemptions are included in C as funds available. Whether each is accepted as a known source is for the authority to determine.",
    "Purchases of property and investments are reflected through assets (B) and are not counted as expenditure in D.",
    "Approved own-account transfers, cash re-deposits and duplicate credits are excluded from C and D.",
    includeFamily
      ? "Family members' assets and income are included (combined view)."
      : "Only assets and accounts held by the subject (self or joint) are included. Family holdings are excluded.",
  );
  const jointShare = (pct: number | null) => (pct != null ? pct / 100 : 1);

  const assetLines = (asOf: string, strict: boolean) => {
    const lines: { label: string; amount: number; basis: string; sourceKind: string; sourceId: number }[] = [];
    for (const a of assets) {
      if (!inScopeOwnership(a.ownership)) continue;
      if (!a.acquisitionDate) continue;
      const held = (strict ? a.acquisitionDate < asOf : a.acquisitionDate <= asOf) && (!a.disposalDate || a.disposalDate > asOf);
      if (!held) continue;
      const cost = (a.purchasePrice ?? 0) + (a.registrationCost ?? 0);
      const share = jointShare(a.ownershipSharePercent);
      const amount = round2(cost * share);
      const owner = a.familyMemberId ? familyName.get(a.familyMemberId) : a.ownership;
      lines.push({
        label: `${a.description} (${a.assetType.replace(/_/g, " ")})`,
        amount,
        basis: `Cost Rs. ${formatINR(cost)}${share !== 1 ? ` x ${(share * 100).toFixed(0)}% share` : ""}; acquired ${a.acquisitionDate}; held by ${owner}${a.purchasePrice == null ? "; purchase price not recorded" : ""}`,
        sourceKind: "asset",
        sourceId: a.id,
      });
    }
    for (const acct of scopeAccounts) {
      const prior = txns
        .filter((t) => t.bankAccountId === acct.id && t.balance !== null && (strict ? t.txnDate < asOf : t.txnDate <= asOf))
        .sort((x, y) => x.txnDate.localeCompare(y.txnDate) || x.id - y.id);
      const last = prior[prior.length - 1];
      if (!last) continue;
      lines.push({
        label: `Bank balance — ${acct.bankName} ${acct.maskedAccountNumber}`,
        amount: round2(Math.max(0, last.balance ?? 0)),
        basis: `Statement balance on ${last.txnDate} (transaction #${last.id})`,
        sourceKind: "transaction",
        sourceId: last.id,
      });
    }
    return lines;
  };

  const A = assetLines(start, true);
  const B = assetLines(end, false);

  const inPeriod = (d: string) => d >= start! && d <= end!;
  const txnInScope = txns.filter((t) => scopeAccountIds.has(t.bankAccountId) && inPeriod(t.txnDate) && !excluded.has(t.id));
  const entriesInScope = entries.filter((e) => inPeriod(e.entryDate) && (includeFamily || e.familyMemberId == null));

  const group = (rows: { category: string; amount: number; kind: string; id: number }[]) => {
    const m = new Map<string, { amount: number; n: number; kinds: Set<string> }>();
    for (const r of rows) {
      const g = m.get(r.category) ?? { amount: 0, n: 0, kinds: new Set<string>() };
      g.amount += r.amount;
      g.n++;
      g.kinds.add(r.kind);
      m.set(r.category, g);
    }
    return [...m.entries()].map(([category, g]) => ({
      label: category.replace(/_/g, " "),
      amount: round2(g.amount),
      basis: `${g.n} record(s) from ${[...g.kinds].join(" and ")} with approved category "${category}" between ${start} and ${end}`,
      sourceKind: null,
      sourceId: null,
    }));
  };

  const cRows = [
    ...txnInScope
      .filter((t) => t.category && t.credit > 0 && (INCOME_CATEGORIES.has(t.category) || DA_RECEIPTS_IN_C.has(t.category)))
      .map((t) => ({ category: t.category!, amount: t.credit, kind: "bank transactions", id: t.id })),
    ...entriesInScope
      .filter((e) => e.entryType === "income" || (e.entryType === "receipt" && DA_RECEIPTS_IN_C.has(e.category)))
      .map((e) => ({ category: e.category, amount: e.amount, kind: "manual ledger entries", id: e.id })),
  ];
  const dRows = [
    ...txnInScope
      .filter((t) => t.category && t.debit > 0 && EXPENDITURE_CATEGORIES.has(t.category))
      .map((t) => ({ category: t.category!, amount: t.debit, kind: "bank transactions", id: t.id })),
    ...entriesInScope
      .filter((e) => e.entryType === "expenditure")
      .map((e) => ({ category: e.category, amount: e.amount, kind: "manual ledger entries", id: e.id })),
  ];
  const C = group(cRows);
  const D = group(dRows);

  const sum = (l: { amount: number }[]) => round2(l.reduce((s, x) => s + x.amount, 0));
  const a = sum(A), b = sum(B), cc = sum(C), d = sum(D);
  const assetsAcquired = round2(b - a);
  const likelySavings = round2(cc - d);
  const disproportion = round2(assetsAcquired - likelySavings);
  const disproportionPercent = cc > 0 ? round2((disproportion / cc) * 100) : null;

  // Missing information
  const scopedAssets = assets.filter((x) => inScopeOwnership(x.ownership));
  const noDate = scopedAssets.filter((x) => !x.acquisitionDate);
  if (noDate.length) missing.push(`${noDate.length} asset(s) have no acquisition date and are excluded from A and B: ${noDate.map((x) => x.description).join(", ")}`);
  const noPrice = scopedAssets.filter((x) => x.acquisitionDate && x.purchasePrice == null);
  if (noPrice.length) missing.push(`${noPrice.length} asset(s) have no purchase price recorded (counted as zero): ${noPrice.map((x) => x.description).join(", ")}`);
  const unclassified = txnInScope.filter((t) => !t.category);
  if (unclassified.length) missing.push(`${unclassified.length} transaction(s) in the check period are not categorised and are not reflected in C or D.`);
  for (const acct of scopeAccounts) {
    const has = txns.some((t) => t.bankAccountId === acct.id && t.balance !== null && t.txnDate < start!);
    if (!has) missing.push(`No statement balance before the check period for ${acct.bankName} ${acct.maskedAccountNumber}; its opening balance is not in A.`);
  }
  if (!docs.some((x) => x.category === "itr")) missing.push("No income tax returns (ITR) are in the document repository to corroborate income.");
  if (liabilities.length && !liabilities.some((l) => l.outstandingAtEnd != null)) missing.push("Outstanding loan balances at the end of the check period are not recorded.");
  if (cc === 0) missing.push("No income is recorded for the check period, so a percentage cannot be computed.");

  return {
    ...base,
    components: [
      { code: "A", label: COMPONENT_LABELS.A, amount: a, lines: A },
      { code: "B", label: COMPONENT_LABELS.B, amount: b, lines: B },
      { code: "C", label: COMPONENT_LABELS.C, amount: cc, lines: C },
      { code: "D", label: COMPONENT_LABELS.D, amount: d, lines: D },
    ],
    assetsAcquired,
    likelySavings,
    disproportion,
    disproportionPercent,
    assumptions,
    missingInformation: missing,
  };
}

const COMPONENT_LABELS = {
  A: "Assets held at the beginning of the check period",
  B: "Assets held at the end of the check period",
  C: "Income and receipts during the check period",
  D: "Expenditure during the check period",
} as const;

export async function blindSpots(caseId: number) {
  const [txns, assets, liabilities, family, entries, reviews] = await Promise.all([
    db.select().from(transactionsTable).where(eq(transactionsTable.caseId, caseId)),
    db.select().from(assetsTable).where(eq(assetsTable.caseId, caseId)),
    db.select().from(liabilitiesTable).where(eq(liabilitiesTable.caseId, caseId)),
    db.select().from(familyMembersTable).where(eq(familyMembersTable.caseId, caseId)),
    db.select().from(ledgerEntriesTable).where(eq(ledgerEntriesTable.caseId, caseId)),
    db.select().from(blindSpotReviewsTable).where(eq(blindSpotReviewsTable.caseId, caseId)),
  ]);
  const excluded = await excludedTransferIds(caseId);
  type Spot = { code: string; title: string; whyItMatters: string; severity: "high" | "medium" | "low"; relatedTransactionIds: number[]; relatedDocumentIds: number[]; suggestedClarification: string };
  const spots: Spot[] = [];
  const cap = (ids: number[]) => ids.slice(0, 200);

  const bigUnexplained = txns.filter((t) => t.credit >= 100000 && t.classificationStatus !== "approved");
  if (bigUnexplained.length)
    spots.push({
      code: "UNEXPLAINED_HIGH_CREDITS",
      title: `${bigUnexplained.length} credit(s) of Rs. 1 lakh or more have no approved source category`,
      whyItMatters: "High-value credits without an established source are commonly the first items raised in DA and scrutiny proceedings.",
      severity: "high",
      relatedTransactionIds: cap(bigUnexplained.map((t) => t.id)),
      relatedDocumentIds: [],
      suggestedClarification: "Identify the payer and nature of each credit and link supporting documents (sale deed, loan sanction, gift deed, salary slip).",
    });
  const cash = txns.filter((t) => t.credit > 0 && (t.category === "cash_deposit" || /\b(CASH DEP|BY CASH|CASH DEPOSIT|CDM)\b/i.test(t.description)));
  if (cash.length) {
    const total = cash.reduce((s, t) => s + t.credit, 0);
    spots.push({
      code: "CASH_DEPOSITS",
      title: `${cash.length} cash deposit(s) totalling Rs. ${formatINR(total)}`,
      whyItMatters: "Cash deposits have no inherent audit trail; their source must be shown independently.",
      severity: total >= 500000 ? "high" : "medium",
      relatedTransactionIds: cap(cash.map((t) => t.id)),
      relatedDocumentIds: [],
      suggestedClarification: "Explain the source of each cash deposit (prior withdrawal, agricultural sale, rent received in cash) with corroborating records.",
    });
  }
  const undocumented = txns.filter((t) => Math.max(t.credit, t.debit) >= 500000 && t.documentIds.length === 0);
  if (undocumented.length)
    spots.push({
      code: "HIGH_VALUE_WITHOUT_DOCUMENTS",
      title: `${undocumented.length} transaction(s) of Rs. 5 lakh or more have no linked document`,
      whyItMatters: "Large movements are expected to be supported by documentary evidence.",
      severity: "medium",
      relatedTransactionIds: cap(undocumented.map((t) => t.id)),
      relatedDocumentIds: [],
      suggestedClarification: "Upload and link the supporting document for each high-value transaction.",
    });
  const round = txns.filter((t) => t.credit >= 50000 && t.credit % 10000 === 0 && t.classificationStatus !== "approved" && !excluded.has(t.id));
  if (round.length)
    spots.push({
      code: "ROUND_SUM_CREDITS",
      title: `${round.length} unexplained round-sum credit(s)`,
      whyItMatters: "Round-sum credits are often questioned as possible cash introductions or accommodation entries.",
      severity: "medium",
      relatedTransactionIds: cap(round.map((t) => t.id)),
      relatedDocumentIds: [],
      suggestedClarification: "Explain the counterparty and purpose of each round-sum credit.",
    });
  const noSource = assets.filter((a) => !a.sourceOfFunds);
  if (noSource.length)
    spots.push({
      code: "ASSETS_WITHOUT_SOURCE_OF_FUNDS",
      title: `${noSource.length} asset(s) have no source of funds recorded`,
      whyItMatters: "Each acquisition during the check period is examined against the funds available at the time.",
      severity: "high",
      relatedTransactionIds: [],
      relatedDocumentIds: [...new Set(noSource.flatMap((a) => a.documentIds))],
      suggestedClarification: `Record the source of funds for: ${noSource.map((a) => a.description).join("; ")}`,
    });
  const noCost = assets.filter((a) => a.purchasePrice == null);
  if (noCost.length)
    spots.push({
      code: "ASSETS_WITHOUT_COST",
      title: `${noCost.length} asset(s) have no purchase price`,
      whyItMatters: "Without cost, the asset cannot be placed correctly in the DA statement and may be valued by the authority instead.",
      severity: "medium",
      relatedTransactionIds: [],
      relatedDocumentIds: [],
      suggestedClarification: "Record purchase price and registration cost from the sale deed or invoice.",
    });
  const loanCredits = txns.filter((t) => t.category === "bank_loan" || t.category === "personal_loan");
  if (loanCredits.length && liabilities.length === 0)
    spots.push({
      code: "LOANS_WITHOUT_LIABILITY_RECORD",
      title: "Loan receipts exist but no liability is recorded",
      whyItMatters: "Loans claimed as a source of funds need matching liability records (sanction, repayment schedule).",
      severity: "medium",
      relatedTransactionIds: cap(loanCredits.map((t) => t.id)),
      relatedDocumentIds: [],
      suggestedClarification: "Add each loan under Liabilities with sanction date, principal and outstanding balances.",
    });
  const famNoEvidence = family.filter((f) => f.hasIndependentIncome && !entries.some((e) => e.familyMemberId === f.id));
  if (famNoEvidence.length)
    spots.push({
      code: "FAMILY_INCOME_NOT_EVIDENCED",
      title: `Independent income claimed for ${famNoEvidence.map((f) => f.name).join(", ")} without recorded income entries`,
      whyItMatters: "Family members' independent income is often disputed unless separately evidenced (ITRs, salary records).",
      severity: "medium",
      relatedTransactionIds: [],
      relatedDocumentIds: [],
      suggestedClarification: "Record the family member's income as ledger entries and upload their ITRs or salary records.",
    });
  const ownUnmatched = txns.filter((t) => t.category === "own_account_transfer" && t.reconciliationStatus !== "reconciled");
  if (ownUnmatched.length)
    spots.push({
      code: "UNMATCHED_OWN_TRANSFERS",
      title: `${ownUnmatched.length} own-account transfer(s) are not matched to the other side`,
      whyItMatters: "Unmatched transfers may indicate an undisclosed account or may be double counted as income.",
      severity: "low",
      relatedTransactionIds: cap(ownUnmatched.map((t) => t.id)),
      relatedDocumentIds: [],
      suggestedClarification: "Import the counterpart account statement or create a manual match.",
    });
  // Statement gaps of more than 60 days per account
  const byAcct = new Map<number, typeof txns>();
  for (const t of txns) byAcct.set(t.bankAccountId, [...(byAcct.get(t.bankAccountId) ?? []), t]);
  const gaps: string[] = [];
  for (const [, list] of byAcct) {
    const sorted = [...list].sort((a, b) => a.txnDate.localeCompare(b.txnDate));
    for (let i = 1; i < sorted.length; i++) {
      const g = (Date.parse(sorted[i]!.txnDate) - Date.parse(sorted[i - 1]!.txnDate)) / 86400000;
      if (g > 60) gaps.push(`${sorted[i - 1]!.txnDate} to ${sorted[i]!.txnDate}`);
    }
  }
  if (gaps.length)
    spots.push({
      code: "STATEMENT_GAPS",
      title: `${gaps.length} gap(s) of more than 60 days in imported statements`,
      whyItMatters: "Missing statement periods leave balances and movements unaccounted for.",
      severity: "low",
      relatedTransactionIds: [],
      relatedDocumentIds: [],
      suggestedClarification: `Confirm whether statements are missing for: ${gaps.slice(0, 5).join("; ")}${gaps.length > 5 ? "…" : ""}`,
    });

  const reviewMap = new Map(reviews.map((r) => [r.code, r]));
  return spots.map((s) => ({
    ...s,
    reviewStatus: reviewMap.get(s.code)?.reviewStatus ?? "open",
    reviewNote: reviewMap.get(s.code)?.reviewNote ?? null,
  }));
}
