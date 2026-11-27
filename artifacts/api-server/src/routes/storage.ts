import { Readable } from "stream";
import { eq } from "drizzle-orm";
import { db, documentsTable } from "@workspace/db";
import { RequestUploadUrlBody } from "@workspace/api-zod";
import express, { Router, type IRouter, type Request, type Response } from "express";
import { ObjectNotFoundError, ObjectStorageService } from "../lib/objectStorage";
import { localObjectDir, saveLocalObject } from "../lib/localObjectStorage";
import { loadCase } from "../lib/access";

const router: IRouter = Router();
const objectStorageService = new ObjectStorageService();

const MAX_UPLOAD_BYTES = 50 * 1024 * 1024;

/** Mints a presigned upload URL. requireUser is mounted before this router, so callers are signed in. */
router.post("/storage/uploads/request-url", async (req: Request, res: Response) => {
  const parsed = RequestUploadUrlBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Missing or invalid required fields" });
    return;
  }
  if (parsed.data.size > MAX_UPLOAD_BYTES) {
    res.status(400).json({ error: "Files larger than 50 MB are not accepted" });
    return;
  }
  try {
    const { name, size, contentType } = parsed.data;
    const uploadURL = await objectStorageService.getObjectEntityUploadURL();
    const objectPath = objectStorageService.normalizeObjectEntityPath(uploadURL);
    res.json({ uploadURL, objectPath, metadata: { name, size, contentType } });
  } catch (error) {
    req.log.error({ err: error }, "Error generating upload URL");
    res.status(500).json({ error: "Failed to generate upload URL" });
  }
});

/** Receives the file body for a URL minted above when disk storage (LOCAL_OBJECT_DIR) is enabled. */
router.put(
  "/storage/local-uploads/:id",
  express.raw({ type: () => true, limit: MAX_UPLOAD_BYTES }),
  async (req: Request, res: Response) => {
    if (!localObjectDir()) {
      res.status(404).json({ error: "Local storage is not enabled" });
      return;
    }
    const id = String(req.params.id);
    if (!/^[0-9a-f-]{36}$/.test(id) || !Buffer.isBuffer(req.body)) {
      res.status(400).json({ error: "Invalid upload" });
      return;
    }
    try {
      await saveLocalObject(id, req.body, req.get("content-type") || "application/octet-stream");
      res.status(200).end();
    } catch (error) {
      req.log.error({ err: error }, "Error saving local upload");
      res.status(500).json({ error: "Failed to save upload" });
    }
  },
);

/** Serves a private object only if it is a registered document in a case the user can read. */
router.get("/storage/objects/*path", async (req: Request, res: Response) => {
  try {
    const raw = req.params.path;
    const wildcardPath = Array.isArray(raw) ? raw.join("/") : raw;
    const objectPath = `/objects/${wildcardPath}`;
    const [doc] = await db.select().from(documentsTable).where(eq(documentsTable.objectPath, objectPath));
    if (!doc) {
      res.status(404).json({ error: "Object not found" });
      return;
    }
    const ctx = await loadCase(req, res, doc.caseId, "read");
    if (!ctx) return;
    const objectFile = await objectStorageService.getObjectEntityFile(objectPath);
    const response = await objectStorageService.downloadObject(objectFile);
    res.status(response.status);
    response.headers.forEach((value, key) => res.setHeader(key, value));
    res.setHeader("Content-Disposition", `inline; filename="${doc.name.replace(/"/g, "")}"`);
    if (response.body) {
      Readable.fromWeb(response.body as ReadableStream<Uint8Array>).pipe(res);
    } else {
      res.end();
    }
  } catch (error) {
    if (error instanceof ObjectNotFoundError) {
      res.status(404).json({ error: "Object not found" });
      return;
    }
    req.log.error({ err: error }, "Error serving object");
    res.status(500).json({ error: "Failed to serve object" });
  }
});

export default router;
