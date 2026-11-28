// Adds a "Judgment copy" link after each case named in the answer's final
// (judicial precedents) section. Links are built here, never by the model:
// the library's own source URL when the judgment is in the library, otherwise
// an Indian Kanoon search for the case name.
type LibraryJudgment = { title: string; sourceUrl: string | null };

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

export function judgmentUrl(caseName: string, library: LibraryJudgment[]): string {
  const n = norm(caseName);
  const hit = library.find((j) => j.sourceUrl && (norm(j.title).includes(n) || n.includes(norm(j.title))));
  return hit?.sourceUrl ?? `https://indiankanoon.org/search/?formInput=${encodeURIComponent(caseName)}`;
}

export function addJudgmentLinks(answer: string, library: LibraryJudgment[], label: string): string {
  const lines = answer.split("\n");
  let start = -1;
  for (let i = lines.length - 1; i >= 0; i--) if (/^#{1,6}\s/.test(lines[i]!)) { start = i; break; }
  if (start < 0) return answer;
  for (let i = start + 1; i < lines.length; i++) {
    const m = lines[i]!.match(/^\s*[-*]\s+\*\*([^*]+?)\*\*/);
    if (!m || !/\bv(s)?\.?\s/i.test(m[1]!) || /\]\(https?:/.test(lines[i]!)) continue;
    lines[i] = `${lines[i]!.trimEnd()} [${label}](${judgmentUrl(m[1]!.trim(), library)})`;
  }
  return lines.join("\n");
}
