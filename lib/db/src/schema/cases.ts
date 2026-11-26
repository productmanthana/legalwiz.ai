import { pgTable, text, serial, timestamp, boolean, integer, date, index } from "drizzle-orm/pg-core";
import { usersTable } from "./users";

export const casesTable = pgTable("cases", {
  id: serial("id").primaryKey(),
  ownerId: integer("owner_id").notNull().references(() => usersTable.id),
  title: text("title").notNull(),
  referenceNumber: text("reference_number"),
  caseType: text("case_type").notNull(),
  investigatingAuthority: text("investigating_authority"),
  jurisdiction: text("jurisdiction"),
  subjectName: text("subject_name"),
  periodStart: date("period_start", { mode: "string" }),
  periodEnd: date("period_end", { mode: "string" }),
  noticeDate: date("notice_date", { mode: "string" }),
  noticeDetails: text("notice_details"),
  officerDetails: text("officer_details"),
  assignedAdvocate: text("assigned_advocate"),
  assignedCa: text("assigned_ca"),
  status: text("status").notNull().default("open"),
  legislation: text("legislation"),
  submissionDeadline: date("submission_deadline", { mode: "string" }),
  isDemo: boolean("is_demo").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [index("cases_owner_idx").on(t.ownerId)]);

export const investigationPeriodsTable = pgTable("investigation_periods", {
  id: serial("id").primaryKey(),
  caseId: integer("case_id").notNull().references(() => casesTable.id, { onDelete: "cascade" }),
  label: text("label").notNull(),
  startDate: date("start_date", { mode: "string" }).notNull(),
  endDate: date("end_date", { mode: "string" }).notNull(),
  periodType: text("period_type").notNull(),
});

export const caseSharesTable = pgTable("case_shares", {
  id: serial("id").primaryKey(),
  caseId: integer("case_id").notNull().references(() => casesTable.id, { onDelete: "cascade" }),
  email: text("email").notNull(),
  accessRole: text("access_role").notNull(),
  note: text("note"),
  createdBy: text("created_by"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [index("case_shares_email_idx").on(t.email)]);

export type CaseRow = typeof casesTable.$inferSelect;
