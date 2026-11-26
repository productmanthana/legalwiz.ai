import { Router, type IRouter } from "express";
import { and, desc, eq, ilike, or, type SQL } from "drizzle-orm";
import { db, documentsTable, transactionsTable } from "@workspace/db";
import { CreateDocumentBody, UpdateDocumentBody, ListDocumentsQueryParams } from "@workspace/api-zod";
import { intParam, loadCase } from "../lib/access";
import { audit, diff } from "../lib/audit";
import { serializeDocs } from "../lib/serialize";
import { ObjectNotFoundError, ObjectStorageService } from "../lib/objectStorage";

const router: IRouter = Router();
const storage = new ObjectStorageService();

async function allDocs(caseId: number) {
  return db.select().from(documentsTable).where(eq(documentsTable.caseId, caseId));
}

router.get("/cases/:caseId/documents", async (req, res): Promise<void> => {
  const ctx = await loadCase(req, res, intParam(req, "caseId"));
  if (!ctx) return;
  const q = ListDocumentsQueryParams.safeParse(req.query);
  if (!q.success) {
    res.status(400).json({ error: q.error.message });
    return;
  }
  const conds: SQL[] = [eq(documentsTable.caseId, ctx.c.id), eq(documentsTable.isArchived, false)];
  if (q.data.category) conds.push(eq(documentsTable.category, q.data.category));
  if (q.data.search) conds.push(or(ilike(documentsTable.name, `%${q.data.search}%`), ilike(documentsTable.description, `%${q.data.search}%`))!);
  const rows = await db.select().from(documentsTable).where(and(...conds)).orderBy(desc(documentsTable.createdAt));
  res.json(serializeDocs(rows, await allDocs(ctx.c.id)));
});

router.post("/cases/:caseId/documents", async (req, res): Promise<void> => {
  const ctx = await loadCase(req, res, intParam(req, "caseId"), "edit");
  if (!ctx) return;
  const parsed = CreateDocumentBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const b = parsed.data;
  if (!b.objectPath.startsWith("/objects/")) {
    res.status(400).json({ error: "Invalid storage path" });
    return;
  }
  try {
    await storage.getObjectEntityFile(b.objectPath);
  } catch (err) {
    if (err instanceof ObjectNotFoundError) {
      res.status(400).json({ error: "The uploaded file was not found in storage. Upload it again." });
      return;
    }
    throw err;
  }
  const [taken] = await db.select({ id: documentsTable.id, caseId: documentsTable.caseId }).from(documentsTable).where(eq(documentsTable.objectPath, b.objectPath));
  if (taken) {
    res.status(409).json({ error: "This stored file is already registered" });
    return;
  }
  let version = 1;
  if (b.previousVersionId) {
    const [prev] = await db.select().from(documentsTable).where(eq(documentsTable.id, b.previousVersionId));
    if (!prev || prev.caseId !== ctx.c.id) {
      res.status(400).json({ error: "Previous version not found in this case" });
      return;
    }
    version = prev.version + 1;
    // The earlier version is preserved (archived), never deleted.
    await db.update(documentsTable).set({ isArchived: true }).where(eq(documentsTable.id, prev.id));
  }
  const [d] = await db
    .insert(documentsTable)
    .values({ ...b, sha256: b.sha256.toLowerCase(), caseId: ctx.c.id, version, uploadedBy: ctx.user.displayName })
    .returning();
  const all = await allDocs(ctx.c.id);
  const [ser] = serializeDocs([d!], all);
  await audit(req, {
    caseId: ctx.c.id,
    caseTitle: ctx.c.title,
    action: b.previousVersionId ? "document.new_version" : "document.uploaded",
    entityType: "document",
    entityId: d!.id,
    summary: `Uploaded "${d!.name}" (v${version}, SHA-256 ${d!.sha256.slice(0, 12)}…)${ser!.isDuplicate ? " — identical file already exists in this case" : ""}`,
    next: { name: d!.name, category: d!.category, sha256: d!.sha256, sizeBytes: d!.sizeBytes },
  });
  res.status(201).json(ser);
});

router.patch("/documents/:documentId", async (req, res): Promise<void> => {
  const [d] = await db.select().from(documentsTable).where(eq(documentsTable.id, intParam(req, "documentId")));
  if (!d) {
    res.status(404).json({ error: "Document not found" });
    return;
  }
  const ctx = await loadCase(req, res, d.caseId, "edit");
  if (!ctx) return;
  const parsed = UpdateDocumentBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const [u] = await db.update(documentsTable).set(parsed.data).where(eq(documentsTable.id, d.id)).returning();
  // Keep the reverse link on transactions in sync.
  if (parsed.data.transactionIds) {
    const before = new Set(d.transactionIds);
    const after = new Set(parsed.data.transactionIds);
    const txns = await db.select().from(transactionsTable).where(eq(transactionsTable.caseId, d.caseId));
    for (const t of txns) {
      const has = t.documentIds.includes(d.id);
      if (after.has(t.id) && !has) await db.update(transactionsTable).set({ documentIds: [...t.documentIds, d.id] }).where(eq(transactionsTable.id, t.id));
      if (!after.has(t.id) && before.has(t.id) && has) await db.update(transactionsTable).set({ documentIds: t.documentIds.filter((x) => x !== d.id) }).where(eq(transactionsTable.id, t.id));
    }
  }
  const dd = diff(d as unknown as Record<string, unknown>, parsed.data);
  await audit(req, { caseId: ctx.c.id, caseTitle: ctx.c.title, action: "document.updated", entityType: "document", entityId: d.id, summary: `Updated "${d.name}"`, previous: dd.previous, next: dd.next });
  res.json(serializeDocs([u!], await allDocs(ctx.c.id))[0]);
});

router.delete("/documents/:documentId", async (req, res): Promise<void> => {
  const [d] = await db.select().from(documentsTable).where(eq(documentsTable.id, intParam(req, "documentId")));
  if (!d) {
    res.status(404).json({ error: "Document not found" });
    return;
  }
  const ctx = await loadCase(req, res, d.caseId, "edit");
  if (!ctx) return;
  await db.update(documentsTable).set({ isArchived: true }).where(eq(documentsTable.id, d.id));
  await audit(req, { caseId: ctx.c.id, caseTitle: ctx.c.title, action: "document.archived", entityType: "document", entityId: d.id, summary: `Archived "${d.name}" (file retained)` });
  res.sendStatus(204);
});

export default router;
