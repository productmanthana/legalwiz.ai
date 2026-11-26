import { pgTable, text, serial, timestamp, boolean, integer, date, jsonb, index } from "drizzle-orm/pg-core";
import { casesTable } from "./cases";

export const investigationQueriesTable = pgTable("investigation_queries", {
  id: serial("id").primaryKey(),
  caseId: integer("case_id").notNull().references(() => casesTable.id, { onDelete: "cascade" }),
  questionNumber: text("question_number").notNull(),
  subject: text("subject").notNull(),
  description: text("description").notNull(),
  topic: text("topic").notNull(),
  financialYear: text("financial_year"),
  applicableSchedule: text("applicable_schedule"),
  responseDeadline: date("response_deadline", { mode: "string" }),
  status: text("status").notNull().default("open"),
  parentQueryId: integer("parent_query_id"),
  relatedTransactionIds: jsonb("related_transaction_ids").$type<number[]>().notNull().default([]),
  relatedAssetIds: jsonb("related_asset_ids").$type<number[]>().notNull().default([]),
  relatedDocumentIds: jsonb("related_document_ids").$type<number[]>().notNull().default([]),
  raisedBy: text("raised_by"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const queryResponsesTable = pgTable("query_responses", {
  id: serial("id").primaryKey(),
  queryId: integer("query_id").notNull().references(() => investigationQueriesTable.id, { onDelete: "cascade" }),
  version: integer("version").notNull(),
  body: text("body").notNull(),
  status: text("status").notNull().default("draft"),
  isAiDraft: boolean("is_ai_draft").notNull().default(false),
  approvedBy: text("approved_by"),
  approvedAt: timestamp("approved_at", { withTimezone: true }),
  submittedAt: timestamp("submitted_at", { withTimezone: true }),
  documentIds: jsonb("document_ids").$type<number[]>().notNull().default([]),
  authorName: text("author_name"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const assessmentsTable = pgTable("assessments", {
  id: serial("id").primaryKey(),
  queryId: integer("query_id").notNull().references(() => investigationQueriesTable.id, { onDelete: "cascade" }),
  responseId: integer("response_id"),
  outcome: text("outcome").notNull(),
  reasons: text("reasons").notNull(),
  assessorName: text("assessor_name"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const documentsTable = pgTable("documents", {
  id: serial("id").primaryKey(),
  caseId: integer("case_id").notNull().references(() => casesTable.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  category: text("category").notNull(),
  description: text("description"),
  objectPath: text("object_path").notNull(),
  sha256: text("sha256").notNull(),
  sizeBytes: integer("size_bytes").notNull(),
  contentType: text("content_type").notNull(),
  version: integer("version").notNull().default(1),
  previousVersionId: integer("previous_version_id"),
  financialYear: text("financial_year"),
  isArchived: boolean("is_archived").notNull().default(false),
  transactionIds: jsonb("transaction_ids").$type<number[]>().notNull().default([]),
  uploadedBy: text("uploaded_by"),
  /** Search indexing (Weaviate): not_indexed | queued | processing | indexed | failed */
  indexStatus: text("index_status").notNull().default("not_indexed"),
  /** How content was extracted: text | vision | mixed */
  indexMethod: text("index_method"),
  indexedPages: integer("indexed_pages").notNull().default(0),
  visionPages: integer("vision_pages").notNull().default(0),
  indexedChunks: integer("indexed_chunks").notNull().default(0),
  indexError: text("index_error"),
  indexedAt: timestamp("indexed_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [index("documents_case_idx").on(t.caseId)]);

export const legalReferencesTable = pgTable("legal_references", {
  id: serial("id").primaryKey(),
  sourceType: text("source_type").notNull(),
  title: text("title").notNull(),
  court: text("court"),
  decisionDate: date("decision_date", { mode: "string" }),
  caseNumber: text("case_number"),
  citation: text("citation"),
  provision: text("provision"),
  sourceUrl: text("source_url"),
  categories: jsonb("categories").$type<string[]>().notNull().default([]),
  legalIssue: text("legal_issue"),
  summary: text("summary"),
  principle: text("principle"),
  relevantParagraphs: text("relevant_paragraphs"),
  subsequentTreatment: text("subsequent_treatment"),
  bindingStatus: text("binding_status").notNull().default("not_assessed"),
  verificationStatus: text("verification_status").notNull().default("unverified"),
  verifiedBy: text("verified_by"),
  verifiedAt: timestamp("verified_at", { withTimezone: true }),
  verificationNote: text("verification_note"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const caseLegalLinksTable = pgTable("case_legal_links", {
  id: serial("id").primaryKey(),
  caseId: integer("case_id").notNull().references(() => casesTable.id, { onDelete: "cascade" }),
  legalReferenceId: integer("legal_reference_id").notNull().references(() => legalReferencesTable.id, { onDelete: "cascade" }),
  queryId: integer("query_id"),
  relevanceNote: text("relevance_note"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const assistantMessagesTable = pgTable("assistant_messages", {
  id: serial("id").primaryKey(),
  caseId: integer("case_id").notNull().references(() => casesTable.id, { onDelete: "cascade" }),
  userId: integer("user_id").notNull(),
  role: text("role").notNull(),
  content: text("content").notNull(),
  citations: jsonb("citations").$type<{ kind: string; id: number; label: string }[]>().notNull().default([]),
  available: boolean("available").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const generatedReportsTable = pgTable("generated_reports", {
  id: serial("id").primaryKey(),
  caseId: integer("case_id").notNull().references(() => casesTable.id, { onDelete: "cascade" }),
  reportType: text("report_type").notNull(),
  format: text("format").notNull(),
  generatedBy: text("generated_by"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

// Append-only. No update/delete paths exist in the API. caseId intentionally has no FK
// so history survives case deletion.
export const auditLogsTable = pgTable("audit_logs", {
  id: serial("id").primaryKey(),
  caseId: integer("case_id"),
  caseTitle: text("case_title"),
  userId: integer("user_id"),
  userName: text("user_name"),
  action: text("action").notNull(),
  entityType: text("entity_type").notNull(),
  entityId: integer("entity_id"),
  summary: text("summary"),
  previousValue: text("previous_value"),
  newValue: text("new_value"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [index("audit_case_idx").on(t.caseId), index("audit_entity_idx").on(t.entityType, t.entityId)]);
