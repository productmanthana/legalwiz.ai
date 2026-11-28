import { Router, type IRouter } from "express";
import { and, desc, eq, gte, ilike, lt, or, type SQL } from "drizzle-orm";
import { db, generatedReportsTable, auditLogsTable, usersTable } from "@workspace/db";
import { ExportReportQueryParams, ListAuditLogsQueryParams } from "@workspace/api-zod";
import { currentUser, intParam, isAuditAdmin, loadCase } from "../lib/access";
import { audit } from "../lib/audit";
import { REPORT_TYPES, buildReport, renderDocx, renderPdf, renderXlsx } from "../lib/reports";

const router: IRouter = Router();

const MIME: Record<string, string> = {
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  pdf: "application/pdf",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
};

router.get("/report-types", (_req, res): void => {
  res.json(REPORT_TYPES);
});

router.get("/cases/:caseId/reports", async (req, res): Promise<void> => {
  const ctx = await loadCase(req, res, intParam(req, "caseId"));
  if (!ctx) return;
  res.json(await db.select().from(generatedReportsTable).where(eq(generatedReportsTable.caseId, ctx.c.id)).orderBy(desc(generatedReportsTable.createdAt)).limit(100));
});

router.get("/cases/:caseId/reports/export", async (req, res): Promise<void> => {
  const ctx = await loadCase(req, res, intParam(req, "caseId"));
  if (!ctx) return;
  const q = ExportReportQueryParams.safeParse(req.query);
  if (!q.success) {
    res.status(400).json({ error: q.error.message });
    return;
  }
  const { type, format } = q.data;
  const model = await buildReport(ctx.c, type, ctx.user.displayName);
  if (!model) {
    res.status(400).json({ error: `Unknown report type "${type}"` });
    return;
  }
  const buf = format === "xlsx" ? await renderXlsx(model) : format === "pdf" ? await renderPdf(model) : await renderDocx(model);
  await db.insert(generatedReportsTable).values({ caseId: ctx.c.id, reportType: type, format, generatedBy: ctx.user.displayName });
  await audit(req, { caseId: ctx.c.id, caseTitle: ctx.c.title, action: "report.exported", entityType: "report", summary: `Exported ${model.title} as ${format.toUpperCase()}` });
  const safe = `${ctx.c.title}-${type}`.replace(/[^A-Za-z0-9-_]+/g, "_").slice(0, 80);
  res.setHeader("Content-Type", MIME[format]!);
  res.setHeader("Content-Disposition", `attachment; filename="${safe}.${format}"`);
  res.send(buf);
});

router.get("/audit-logs", async (req, res): Promise<void> => {
  const q = ListAuditLogsQueryParams.safeParse(req.query);
  if (!q.success) {
    res.status(400).json({ error: q.error.message });
    return;
  }
  if (!isAuditAdmin(currentUser(req))) {
    res.status(403).json({ error: "Only the audit administrator can view the audit history" });
    return;
  }
  const f = q.data;
  const like = (v: string) => `%${v.trim()}%`;
  const conds: SQL[] = [];
  if (f.caseId) conds.push(eq(auditLogsTable.caseId, f.caseId));
  if (f.action?.trim()) conds.push(ilike(auditLogsTable.action, like(f.action)));
  if (f.user?.trim()) conds.push(or(ilike(auditLogsTable.userName, like(f.user)), ilike(usersTable.email, like(f.user)))!);
  if (f.caseTitle?.trim()) conds.push(ilike(auditLogsTable.caseTitle, like(f.caseTitle)));
  if (f.from) conds.push(gte(auditLogsTable.createdAt, new Date(`${f.from}T00:00:00+05:30`)));
  if (f.to) conds.push(lt(auditLogsTable.createdAt, new Date(new Date(`${f.to}T00:00:00+05:30`).getTime() + 86_400_000)));
  const rows = await db
    .select({ log: auditLogsTable, userEmail: usersTable.email })
    .from(auditLogsTable)
    .leftJoin(usersTable, eq(usersTable.id, auditLogsTable.userId))
    .where(and(...conds))
    .orderBy(desc(auditLogsTable.createdAt))
    .limit(Math.min(f.limit ?? 300, 2000));
  res.json(rows.map(({ log: { userId: _u, ...r }, userEmail }) => ({ ...r, userEmail })));
});

export default router;
