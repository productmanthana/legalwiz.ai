import { eq } from "drizzle-orm";
import { db, documentsTable } from "@workspace/db";
import { logger } from "./logger";
import { ObjectStorageService } from "./objectStorage";
import { extractDocument, type ExtractedPage } from "./documentExtract";
import { replaceDocumentChunks, weaviateConfigured, type ChunkInput } from "./weaviate";

const storage = new ObjectStorageService();
const running = new Set<number>();

const CHUNK_CHARS = 1500;
const OVERLAP_CHARS = 200;

/** Splits page text into overlapping chunks, preferring paragraph/line boundaries. */
export function chunkText(text: string, size = CHUNK_CHARS, overlap = OVERLAP_CHARS): string[] {
  const clean = text.replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
  if (!clean) return [];
  if (clean.length <= size) return [clean];
  const chunks: string[] = [];
  let start = 0;
  while (start < clean.length) {
    let end = Math.min(start + size, clean.length);
    if (end < clean.length) {
      const window = clean.slice(start, end);
      const cut = Math.max(window.lastIndexOf("\n\n"), window.lastIndexOf("\n"), window.lastIndexOf(". "));
      if (cut > size * 0.5) end = start + cut + 1;
    }
    chunks.push(clean.slice(start, end).trim());
    if (end >= clean.length) break;
    start = end - overlap;
  }
  return chunks.filter(Boolean);
}

function methodOf(pages: ExtractedPage[]): "text" | "vision" | "mixed" {
  const vision = pages.filter((p) => p.method !== "text").length;
  if (vision === 0) return "text";
  return pages.every((p) => p.method === "vision") ? "vision" : "mixed";
}

/** Marks a document queued and indexes it in the background. Never throws. */
export async function queueDocumentIndex(documentId: number): Promise<void> {
  if (!weaviateConfigured()) return;
  await db.update(documentsTable).set({ indexStatus: "queued", indexError: null }).where(eq(documentsTable.id, documentId));
  void indexDocument(documentId);
}

async function indexDocument(documentId: number): Promise<void> {
  if (running.has(documentId)) return;
  running.add(documentId);
  const set = (v: Partial<typeof documentsTable.$inferInsert>) => db.update(documentsTable).set(v).where(eq(documentsTable.id, documentId));
  try {
    const [d] = await db.select().from(documentsTable).where(eq(documentsTable.id, documentId));
    if (!d) return;
    await set({ indexStatus: "processing", indexError: null });
    const [buf] = await (await storage.getObjectEntityFile(d.objectPath)).download();
    const { kind, pages, warnings } = await extractDocument(buf, d.name, d.contentType);

    const chunks: ChunkInput[] = [];
    for (const p of pages) {
      chunkText(p.text).forEach((content, i) =>
        chunks.push({ documentId: d.id, documentName: d.name, category: d.category, pageNumber: p.pageNumber, chunkIndex: i, method: p.method, content }),
      );
    }
    if (chunks.length === 0) throw new Error(warnings[0] ?? "No readable text was found in this document.");
    await replaceDocumentChunks(d.caseId, d.id, chunks);
    await set({
      indexStatus: "indexed",
      indexMethod: methodOf(pages),
      indexedPages: pages.length,
      visionPages: pages.filter((p) => p.method !== "text").length,
      indexedChunks: chunks.length,
      indexError: warnings.length ? warnings.join(" ") : null,
      indexedAt: new Date(),
    });
    logger.info({ documentId, kind, pages: pages.length, chunks: chunks.length }, "Document indexed");
  } catch (err) {
    logger.error({ err, documentId }, "Document indexing failed");
    await set({ indexStatus: "failed", indexError: err instanceof Error ? err.message : String(err) }).catch(() => {});
  } finally {
    running.delete(documentId);
  }
}
