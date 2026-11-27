import { listCaseChunks, searchCaseChunks, type ChunkInput } from "./weaviate";

/** Up to this many characters of document text go to the model in full (~100k tokens). */
const FULL_TEXT_BUDGET = 400_000;

export type PagePassage = { documentId: number; documentName: string; pageNumber: number; method: ChunkInput["method"]; content: string };

/** Joins b onto a, dropping the overlap the chunker repeated at the start of b. */
function joinOverlap(a: string, b: string): string {
  for (let k = Math.min(a.length, b.length, 400); k >= 20; k--) {
    if (a.endsWith(b.slice(0, k))) return a + b.slice(k);
  }
  return `${a}\n${b}`;
}

/** Rebuilds whole pages from stored chunks so every line is counted once. */
function toPages(chunks: ChunkInput[]): PagePassage[] {
  const pages = new Map<string, PagePassage>();
  for (const c of chunks) {
    const key = `${c.documentId}:${c.pageNumber}`;
    const p = pages.get(key);
    if (p) p.content = joinOverlap(p.content, c.content);
    else pages.set(key, { documentId: c.documentId, documentName: c.documentName, pageNumber: c.pageNumber, method: c.method, content: c.content });
  }
  return [...pages.values()];
}

/**
 * Document text for the assistant: the complete text of every live document when it
 * fits the budget (so totals and lists cover all pages), else the best search matches.
 */
export async function documentPassages(caseId: number, question: string, liveDocIds: Set<number>): Promise<{ complete: boolean; pages: PagePassage[] }> {
  const all = (await listCaseChunks(caseId)).filter((c) => liveDocIds.has(c.documentId));
  const pages = toPages(all);
  if (pages.reduce((n, p) => n + p.content.length, 0) <= FULL_TEXT_BUDGET) return { complete: true, pages };
  const hits = (await searchCaseChunks(caseId, question, 40)).filter((h) => liveDocIds.has(h.documentId));
  return { complete: false, pages: toPages(hits) };
}
