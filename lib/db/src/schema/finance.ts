import { pgTable, text, serial, timestamp, boolean, integer, date, numeric, jsonb, index } from "drizzle-orm/pg-core";
import { casesTable } from "./cases";

const money = (name: string) => numeric(name, { precision: 18, scale: 2, mode: "number" });

export const familyMembersTable = pgTable("family_members", {
  id: serial("id").primaryKey(),
  caseId: integer("case_id").notNull().references(() => casesTable.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  relationship: text("relationship").notNull(),
  dateOfBirth: date("date_of_birth", { mode: "string" }),
  occupation: text("occupation"),
  employer: text("employer"),
  pan: text("pan"),
  hasIndependentIncome: boolean("has_independent_income").notNull().default(false),
  annualIncomeDeclared: money("annual_income_declared"),
  businessInterests: text("business_interests"),
  notes: text("notes"),
});

export const bankAccountsTable = pgTable("bank_accounts", {
  id: serial("id").primaryKey(),
  caseId: integer("case_id").notNull().references(() => casesTable.id, { onDelete: "cascade" }),
  bankName: text("bank_name").notNull(),
  accountHolder: text("account_holder").notNull(),
  accountType: text("account_type").notNull(),
  maskedAccountNumber: text("masked_account_number").notNull(),
  ifsc: text("ifsc"),
  branch: text("branch"),
  ownership: text("ownership").notNull(),
  familyMemberId: integer("family_member_id"),
  jointHolders: text("joint_holders"),
  openingDate: date("opening_date", { mode: "string" }),
  closingDate: date("closing_date", { mode: "string" }),
  currency: text("currency").notNull().default("INR"),
});

export const bankStatementsTable = pgTable("bank_statements", {
  id: serial("id").primaryKey(),
  caseId: integer("case_id").notNull().references(() => casesTable.id, { onDelete: "cascade" }),
  bankAccountId: integer("bank_account_id").notNull().references(() => bankAccountsTable.id, { onDelete: "cascade" }),
  fileName: text("file_name").notNull(),
  fileType: text("file_type").notNull(),
  fileHash: text("file_hash").notNull(),
  status: text("status").notNull(),
  periodStart: date("period_start", { mode: "string" }),
  periodEnd: date("period_end", { mode: "string" }),
  rowsImported: integer("rows_imported").notNull().default(0),
  duplicatesSkipped: integer("duplicates_skipped").notNull().default(0),
  balanceCheckStatus: text("balance_check_status"),
  warnings: jsonb("warnings").$type<string[]>().notNull().default([]),
  documentId: integer("document_id"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const transactionsTable = pgTable("transactions", {
  id: serial("id").primaryKey(),
  caseId: integer("case_id").notNull().references(() => casesTable.id, { onDelete: "cascade" }),
  bankAccountId: integer("bank_account_id").notNull().references(() => bankAccountsTable.id, { onDelete: "cascade" }),
  statementId: integer("statement_id"),
  sourceRow: integer("source_row"),
  txnDate: date("txn_date", { mode: "string" }).notNull(),
  valueDate: date("value_date", { mode: "string" }),
  description: text("description").notNull(),
  referenceNumber: text("reference_number"),
  debit: money("debit").notNull().default(0),
  credit: money("credit").notNull().default(0),
  balance: money("balance"),
  // Imported values exactly as read; never modified after import.
  origDescription: text("orig_description").notNull(),
  origDebit: money("orig_debit").notNull().default(0),
  origCredit: money("orig_credit").notNull().default(0),
  origTxnDate: date("orig_txn_date", { mode: "string" }).notNull(),
  origBalance: money("orig_balance"),
  financialYear: text("financial_year").notNull(),
  category: text("category"),
  suggestedCategory: text("suggested_category"),
  suggestionReason: text("suggestion_reason"),
  classificationStatus: text("classification_status").notNull().default("unclassified"),
  reviewStatus: text("review_status").notNull().default("pending"),
  reconciliationStatus: text("reconciliation_status").notNull().default("unreconciled"),
  tags: jsonb("tags").$type<string[]>().notNull().default([]),
  explanation: text("explanation"),
  familyMemberId: integer("family_member_id"),
  documentIds: jsonb("document_ids").$type<number[]>().notNull().default([]),
  isEdited: boolean("is_edited").notNull().default(false),
  dedupeKey: text("dedupe_key").notNull(),
}, (t) => [index("txn_case_idx").on(t.caseId), index("txn_account_idx").on(t.bankAccountId), index("txn_dedupe_idx").on(t.bankAccountId, t.dedupeKey)]);

export const transactionMatchesTable = pgTable("transaction_matches", {
  id: serial("id").primaryKey(),
  caseId: integer("case_id").notNull().references(() => casesTable.id, { onDelete: "cascade" }),
  matchType: text("match_type").notNull(),
  confidence: numeric("confidence", { precision: 5, scale: 2, mode: "number" }).notNull(),
  status: text("status").notNull().default("suggested"),
  amount: money("amount").notNull(),
  dateGapDays: integer("date_gap_days"),
  evidence: jsonb("evidence").$type<string[]>().notNull().default([]),
  sourceIds: jsonb("source_ids").$type<number[]>().notNull(),
  targetIds: jsonb("target_ids").$type<number[]>().notNull(),
  reviewNote: text("review_note"),
  createdBy: text("created_by").notNull().default("engine"),
  reviewedAt: timestamp("reviewed_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const ledgerEntriesTable = pgTable("ledger_entries", {
  id: serial("id").primaryKey(),
  caseId: integer("case_id").notNull().references(() => casesTable.id, { onDelete: "cascade" }),
  entryType: text("entry_type").notNull(),
  category: text("category").notNull(),
  description: text("description"),
  amount: money("amount").notNull(),
  entryDate: date("entry_date", { mode: "string" }).notNull(),
  financialYear: text("financial_year").notNull(),
  familyMemberId: integer("family_member_id"),
  sourceReference: text("source_reference"),
  documentIds: jsonb("document_ids").$type<number[]>().notNull().default([]),
  verificationStatus: text("verification_status").notNull().default("user_provided"),
});

export const blindSpotReviewsTable = pgTable("blind_spot_reviews", {
  id: serial("id").primaryKey(),
  caseId: integer("case_id").notNull().references(() => casesTable.id, { onDelete: "cascade" }),
  code: text("code").notNull(),
  reviewStatus: text("review_status").notNull(),
  reviewNote: text("review_note"),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const assetsTable = pgTable("assets", {
  id: serial("id").primaryKey(),
  caseId: integer("case_id").notNull().references(() => casesTable.id, { onDelete: "cascade" }),
  assetType: text("asset_type").notNull(),
  description: text("description").notNull(),
  acquisitionDate: date("acquisition_date", { mode: "string" }),
  disposalDate: date("disposal_date", { mode: "string" }),
  purchasePrice: money("purchase_price"),
  registrationCost: money("registration_cost"),
  currentValuation: money("current_valuation"),
  valuationBasis: text("valuation_basis"),
  legalOwner: text("legal_owner"),
  ownership: text("ownership").notNull(),
  familyMemberId: integer("family_member_id"),
  ownershipSharePercent: numeric("ownership_share_percent", { precision: 6, scale: 2, mode: "number" }),
  sourceOfFunds: text("source_of_funds"),
  fundingContributionBySubject: money("funding_contribution_by_subject"),
  linkedLiabilityId: integer("linked_liability_id"),
  documentIds: jsonb("document_ids").$type<number[]>().notNull().default([]),
  notes: text("notes"),
});

export const liabilitiesTable = pgTable("liabilities", {
  id: serial("id").primaryKey(),
  caseId: integer("case_id").notNull().references(() => casesTable.id, { onDelete: "cascade" }),
  liabilityType: text("liability_type").notNull(),
  lender: text("lender").notNull(),
  borrower: text("borrower"),
  ownership: text("ownership").notNull(),
  familyMemberId: integer("family_member_id"),
  sanctionDate: date("sanction_date", { mode: "string" }),
  principalAmount: money("principal_amount"),
  outstandingAtStart: money("outstanding_at_start"),
  outstandingAtEnd: money("outstanding_at_end"),
  interestRate: numeric("interest_rate", { precision: 6, scale: 2, mode: "number" }),
  purpose: text("purpose"),
  documentIds: jsonb("document_ids").$type<number[]>().notNull().default([]),
  notes: text("notes"),
});

/**
 * Income Tax figures as reported in a tax record (ITR, AIS, TIS, Form 26AS, Form 16), one row per head.
 * Entered by the user from the uploaded document; compared against bank credits, never merged into them.
 */
export const taxDeclarationsTable = pgTable("tax_declarations", {
  id: serial("id").primaryKey(),
  caseId: integer("case_id").notNull().references(() => casesTable.id, { onDelete: "cascade" }),
  financialYear: text("financial_year").notNull(),
  source: text("source").notNull(),
  head: text("head").notNull(),
  amount: money("amount").notNull(),
  description: text("description"),
  documentId: integer("document_id"),
  notes: text("notes"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [index("tax_decl_case_idx").on(t.caseId)]);
