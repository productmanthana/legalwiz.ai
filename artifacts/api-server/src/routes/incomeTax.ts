import { Router, type IRouter } from "express";
import { eq } from "drizzle-orm";
import { db, taxDeclarationsTable } from "@workspace/db";
import { CreateTaxDeclarationBody, UpdateTaxDeclarationBody } from "@workspace/api-zod";
import { intParam, loadCase } from "../lib/access";
import { audit, diff } from "../lib/audit";
import { incomeTaxComparison, withAssessmentYear } from "../lib/incomeTax";

const router: IRouter = Router();

router.get("/cases/:caseId/tax-declarations", async (req, res): Promise<void> => {
  const ctx = await loadCase(req, res, intParam(req, "caseId"));
  if (!ctx) return;
  const rows = await db.select().from(taxDeclarationsTable).where(eq(taxDeclarationsTable.caseId, ctx.c.id)).orderBy(taxDeclarationsTable.financialYear, taxDeclarationsTable.source);
  res.json(rows.map(withAssessmentYear));
});

router.post("/cases/:caseId/tax-declarations", async (req, res): Promise<void> => {
  const ctx = await loadCase(req, res, intParam(req, "caseId"), "edit");
  if (!ctx) return;
  const parsed = CreateTaxDeclarationBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const values = { ...parsed.data, caseId: ctx.c.id };
  const [d] = await db.insert(taxDeclarationsTable).values(values).returning();
  await audit(req, { caseId: ctx.c.id, caseTitle: ctx.c.title, action: "tax_declaration.created", entityType: "tax_declaration", entityId: d!.id, summary: `Recorded ${d!.source.toUpperCase()} ${d!.head} for FY ${d!.financialYear}: ${d!.amount}`, next: values });
  res.status(201).json(withAssessmentYear(d!));
});

async function loadDeclaration(id: number) {
  const [d] = await db.select().from(taxDeclarationsTable).where(eq(taxDeclarationsTable.id, id));
  return d;
}

router.patch("/tax-declarations/:declarationId", async (req, res): Promise<void> => {
  const d = await loadDeclaration(intParam(req, "declarationId"));
  if (!d) {
    res.status(404).json({ error: "Tax record not found" });
    return;
  }
  const ctx = await loadCase(req, res, d.caseId, "edit");
  if (!ctx) return;
  const parsed = UpdateTaxDeclarationBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const [u] = await db.update(taxDeclarationsTable).set(parsed.data).where(eq(taxDeclarationsTable.id, d.id)).returning();
  const ch = diff(d as unknown as Record<string, unknown>, parsed.data);
  await audit(req, { caseId: ctx.c.id, caseTitle: ctx.c.title, action: "tax_declaration.updated", entityType: "tax_declaration", entityId: d.id, summary: `Updated ${u!.source.toUpperCase()} ${u!.head} for FY ${u!.financialYear}`, previous: ch.previous, next: ch.next });
  res.json(withAssessmentYear(u!));
});

router.delete("/tax-declarations/:declarationId", async (req, res): Promise<void> => {
  const d = await loadDeclaration(intParam(req, "declarationId"));
  if (!d) {
    res.status(404).json({ error: "Tax record not found" });
    return;
  }
  const ctx = await loadCase(req, res, d.caseId, "edit");
  if (!ctx) return;
  await db.delete(taxDeclarationsTable).where(eq(taxDeclarationsTable.id, d.id));
  await audit(req, { caseId: ctx.c.id, caseTitle: ctx.c.title, action: "tax_declaration.deleted", entityType: "tax_declaration", entityId: d.id, summary: `Deleted ${d.source.toUpperCase()} ${d.head} for FY ${d.financialYear}`, previous: d });
  res.sendStatus(204);
});

router.get("/cases/:caseId/income-tax/comparison", async (req, res): Promise<void> => {
  const ctx = await loadCase(req, res, intParam(req, "caseId"));
  if (!ctx) return;
  res.json(await incomeTaxComparison(ctx.c.id));
});

export default router;
