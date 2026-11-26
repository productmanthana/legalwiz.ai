import { Router, type IRouter } from "express";
import { and, eq } from "drizzle-orm";
import { db, ledgerEntriesTable, blindSpotReviewsTable } from "@workspace/db";
import {
  CreateLedgerEntryBody,
  UpdateLedgerEntryBody,
  GetIncomeExpenditureScheduleQueryParams,
  GetDaCalculationQueryParams,
  ReviewBlindSpotBody,
} from "@workspace/api-zod";
import { intParam, loadCase } from "../lib/access";
import { audit, diff } from "../lib/audit";
import { financialYearOf } from "../lib/finance";
import { blindSpots, daCalculation, incomeExpenditure } from "../lib/schedules";

const router: IRouter = Router();

router.get("/cases/:caseId/ledger-entries", async (req, res): Promise<void> => {
  const ctx = await loadCase(req, res, intParam(req, "caseId"));
  if (!ctx) return;
  res.json(await db.select().from(ledgerEntriesTable).where(eq(ledgerEntriesTable.caseId, ctx.c.id)).orderBy(ledgerEntriesTable.entryDate));
});

router.post("/cases/:caseId/ledger-entries", async (req, res): Promise<void> => {
  const ctx = await loadCase(req, res, intParam(req, "caseId"), "edit");
  if (!ctx) return;
  const parsed = CreateLedgerEntryBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const values = { ...parsed.data, caseId: ctx.c.id, financialYear: financialYearOf(parsed.data.entryDate) };
  const [e] = await db.insert(ledgerEntriesTable).values(values).returning();
  await audit(req, { caseId: ctx.c.id, caseTitle: ctx.c.title, action: "ledger_entry.created", entityType: "ledger_entry", entityId: e!.id, summary: `Added ${e!.entryType} "${e!.category}" of ${e!.amount}`, next: values });
  res.status(201).json(e);
});

router.patch("/ledger-entries/:entryId", async (req, res): Promise<void> => {
  const [e] = await db.select().from(ledgerEntriesTable).where(eq(ledgerEntriesTable.id, intParam(req, "entryId")));
  if (!e) {
    res.status(404).json({ error: "Entry not found" });
    return;
  }
  const ctx = await loadCase(req, res, e.caseId, "edit");
  if (!ctx) return;
  const parsed = UpdateLedgerEntryBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const patch = { ...parsed.data, financialYear: financialYearOf(parsed.data.entryDate) };
  const [u] = await db.update(ledgerEntriesTable).set(patch).where(eq(ledgerEntriesTable.id, e.id)).returning();
  const d = diff(e as unknown as Record<string, unknown>, patch);
  await audit(req, { caseId: ctx.c.id, caseTitle: ctx.c.title, action: "ledger_entry.updated", entityType: "ledger_entry", entityId: e.id, summary: `Updated ledger entry "${u!.category}"`, previous: d.previous, next: d.next });
  res.json(u);
});

router.delete("/ledger-entries/:entryId", async (req, res): Promise<void> => {
  const [e] = await db.select().from(ledgerEntriesTable).where(eq(ledgerEntriesTable.id, intParam(req, "entryId")));
  if (!e) {
    res.status(404).json({ error: "Entry not found" });
    return;
  }
  const ctx = await loadCase(req, res, e.caseId, "edit");
  if (!ctx) return;
  await db.delete(ledgerEntriesTable).where(eq(ledgerEntriesTable.id, e.id));
  await audit(req, { caseId: ctx.c.id, caseTitle: ctx.c.title, action: "ledger_entry.deleted", entityType: "ledger_entry", entityId: e.id, summary: `Deleted ledger entry "${e.category}"`, previous: e });
  res.sendStatus(204);
});

router.get("/cases/:caseId/schedules/income-expenditure", async (req, res): Promise<void> => {
  const ctx = await loadCase(req, res, intParam(req, "caseId"));
  if (!ctx) return;
  const q = GetIncomeExpenditureScheduleQueryParams.safeParse(req.query);
  if (!q.success) {
    res.status(400).json({ error: q.error.message });
    return;
  }
  res.json(await incomeExpenditure(ctx.c.id, q.data.granularity ?? "annual"));
});

router.get("/cases/:caseId/schedules/da-calculation", async (req, res): Promise<void> => {
  const ctx = await loadCase(req, res, intParam(req, "caseId"));
  if (!ctx) return;
  const q = GetDaCalculationQueryParams.safeParse(req.query);
  if (!q.success) {
    res.status(400).json({ error: q.error.message });
    return;
  }
  const includeFamily = String(req.query.includeFamily ?? "false") === "true";
  res.json(await daCalculation(ctx.c, includeFamily));
});

router.get("/cases/:caseId/blind-spots", async (req, res): Promise<void> => {
  const ctx = await loadCase(req, res, intParam(req, "caseId"));
  if (!ctx) return;
  res.json(await blindSpots(ctx.c.id));
});

router.put("/cases/:caseId/blind-spots/:code", async (req, res): Promise<void> => {
  const ctx = await loadCase(req, res, intParam(req, "caseId"), "edit");
  if (!ctx) return;
  const parsed = ReviewBlindSpotBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const code = String(req.params.code);
  const spots = await blindSpots(ctx.c.id);
  const spot = spots.find((s) => s.code === code);
  if (!spot) {
    res.status(404).json({ error: "This issue is not currently detected for the case" });
    return;
  }
  const [existing] = await db.select().from(blindSpotReviewsTable).where(and(eq(blindSpotReviewsTable.caseId, ctx.c.id), eq(blindSpotReviewsTable.code, code)));
  if (existing) {
    await db.update(blindSpotReviewsTable).set({ ...parsed.data, updatedAt: new Date() }).where(eq(blindSpotReviewsTable.id, existing.id));
  } else {
    await db.insert(blindSpotReviewsTable).values({ caseId: ctx.c.id, code, reviewStatus: parsed.data.reviewStatus, reviewNote: parsed.data.reviewNote ?? null });
  }
  await audit(req, { caseId: ctx.c.id, caseTitle: ctx.c.title, action: "blind_spot.reviewed", entityType: "blind_spot", summary: `${spot.title}: marked ${parsed.data.reviewStatus.replace(/_/g, " ")}`, previous: { reviewStatus: spot.reviewStatus }, next: parsed.data });
  res.json({ ...spot, reviewStatus: parsed.data.reviewStatus, reviewNote: parsed.data.reviewNote ?? null });
});

export default router;
