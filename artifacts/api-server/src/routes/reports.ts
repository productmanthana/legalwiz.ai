import { Router, type IRouter } from "express";
import { and, desc, eq, type SQL } from "drizzle-orm";
import { db, generatedReportsTable, auditLogsTable } from "@workspace/db";
import { ExportReportQueryParams, ListAuditLogsQueryParams } from "@workspace/api-zod";
import { accessibleCases, currentUser, intParam, loadCase } from "../lib/access";
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
  const user = currentUser(req);
  const conds: SQL[] = [];
  if (q.data.caseId) {
    const ctx = await loadCase(req, res, q.data.caseId);
    if (!ctx) return;
    conds.push(eq(auditLogsTable.caseId, ctx.c.id));
  } else {
    const ids = (await accessibleCases(user)).map((c) => c.c.id);
    // Own actions (incl. deleted cases and library edits) plus everything on accessible cases.
    const rows = await db
      .select()
      .from(auditLogsTable)
      .where(q.data.action ? eq(auditLogsTable.action, q.data.action) : undefined)
      .orderBy(desc(auditLogsTable.createdAt))
      .limit(5000);
    const allowed = new Set(ids);
    const visible = rows.filter((r) => r.userId === user.id || (r.caseId != null && allowed.has(r.caseId)));
    res.json(visible.slice(0, Math.min(q.data.limit ?? 200, 1000)).map(({ userId: _u, ...r }) => r));
    return;
  }
  if (q.data.action) conds.push(eq(auditLogsTable.action, q.data.action));
  const rows = await db
    .select()
    .from(auditLogsTable)
    .where(and(...conds))
    .orderBy(desc(auditLogsTable.createdAt))
    .limit(Math.min(q.data.limit ?? 200, 1000));
  res.json(rows.map(({ userId: _u, ...r }) => r));
});


export default router;
