import type { FieldDef } from "@/components/entity-form";
import { CASE_TYPES, CASE_STATUSES, opts } from "@/lib/format";

export const CASE_FIELDS: FieldDef[] = [
  { name: "title", label: "Case title", required: true, full: true, placeholder: "e.g. Lokayukta enquiry — R. Shivakumar" },
  { name: "caseType", label: "Case type", type: "select", options: opts(Object.keys(CASE_TYPES), CASE_TYPES) },
  { name: "status", label: "Status", type: "select", options: opts(CASE_STATUSES) },
  { name: "referenceNumber", label: "Reference number", placeholder: "Cr. No. 14/2021" },
  { name: "subjectName", label: "Subject (person under investigation)" },
  { name: "investigatingAuthority", label: "Investigating authority" },
  { name: "jurisdiction", label: "Jurisdiction" },
  { name: "legislation", label: "Legislation", placeholder: "PC Act 1988, s.13(1)(b)" },
  { name: "periodStart", label: "Period start", type: "date" },
  { name: "periodEnd", label: "Period end", type: "date" },
  { name: "noticeDate", label: "Notice date", type: "date" },
  { name: "submissionDeadline", label: "Submission deadline", type: "date" },
  { name: "assignedAdvocate", label: "Assigned advocate" },
  { name: "assignedCa", label: "Assigned CA" },
  { name: "officerDetails", label: "Officer details", type: "textarea" },
  { name: "noticeDetails", label: "Notice details", type: "textarea" },
];
