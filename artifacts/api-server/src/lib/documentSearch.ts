import type { PagePassage } from "./assistantContext";
import { fuzzyNameMatch } from "./statementRows";

export type DocSearchQuery = { includeAny?: string[]; documentIds?: number[]; contextLines?: number };

/**
 * Searches EVERY page of every uploaded document (not just the excerpts in the prompt) for lines
 * matching any keyword, tolerating OCR misspellings. Returns each hit with its document, page and
 * the surrounding lines, plus the list of pages and documents that had no hit.
 */
export function searchDocuments(pages: PagePassage[], q: DocSearchQuery) {
  const keys = (q.includeAny ?? []).filter((k) => k.trim());
  const around = Math.min(Math.max(q.contextLines ?? 2, 0), 10);
  const scope = q.documentIds?.length ? pages.filter((p) => q.documentIds!.includes(p.documentId)) : pages;
  const hits: { documentId: number; document: string; page: number; line: number; matched: string[]; text: string }[] = [];
  for (const p of [...scope].sort((a, b) => a.documentId - b.documentId || a.pageNumber - b.pageNumber)) {
    const lines = p.content.split("\n");
    lines.forEach((line, i) => {
      const matched = keys.filter((k) => fuzzyNameMatch(line, k));
      if (!matched.length) return;
      hits.push({ documentId: p.documentId, document: p.documentName, page: p.pageNumber, line: i + 1, matched, text: lines.slice(Math.max(0, i - around), i + around + 1).join("\n").slice(0, 1500) });
    });
  }
  const docs = new Map<number, string>(scope.map((p) => [p.documentId, p.documentName]));
  const hitDocs = new Set(hits.map((h) => h.documentId));
  return {
    pagesSearched: scope.length,
    documentsSearched: docs.size,
    hitCount: hits.length,
    hits: hits.slice(0, 400),
    truncated: hits.length > 400,
    documentsWithNoHit: [...docs].filter(([id]) => !hitDocs.has(id)).map(([id, name]) => ({ documentId: id, document: name })),
  };
}
