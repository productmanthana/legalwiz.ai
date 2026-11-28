import { getClient } from "./vision";

export type OnlineJudgment = { title: string; court: string | null; date: string | null; url: string; summary: string | null };

const SEARCH_MODEL = process.env.WEB_SEARCH_MODEL || "gpt-5.6-terra";

/**
 * Searches the web for judgments matching the query, newest first (including the last few days).
 * Results are research leads only; links come from the search tool, never invented.
 */
// Web searches are slow (~40s); identical queries reuse results for 15 minutes.
const cache = new Map<string, { at: number; results: Promise<OnlineJudgment[]> }>();
const CACHE_MS = 15 * 60 * 1000;

export function searchJudgmentsOnline(query: string): Promise<OnlineJudgment[]> {
  const key = query.toLowerCase().replace(/\s+/g, " ").trim();
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.results;
  const results = runSearch(query);
  cache.set(key, { at: Date.now(), results });
  results.catch(() => cache.delete(key));
  return results;
}

async function runSearch(query: string): Promise<OnlineJudgment[]> {
  const openai = getClient();
  if (!openai) throw new Error("AI is not configured");
  const today = new Date().toISOString().slice(0, 10);
  const resp = await openai.responses.create({
    model: SEARCH_MODEL,
    tools: [{ type: "web_search" }],
    instructions:
      "You are a legal research assistant for Indian law. Use web search to find court judgments and orders that match the user's query. " +
      `Today is ${today}. Include the most recent decisions (this week and this month) as well as older leading judgments. ` +
      "Prefer indiankanoon.org, karnatakajudiciary.kar.nic.in, sci.gov.in, livelaw.in, barandbench.com and scobserver.in. " +
      "Only include results you actually found, each with the real page URL from your search. Never invent cases, dates or links. " +
      'Reply with JSON only: {"results":[{"title":"Case name","court":"Court","date":"YYYY-MM-DD or null","url":"https://...","summary":"one or two sentences"}]}, up to 20 results, newest first.',
    input: `Find judgments for: ${query}`,
    max_output_tokens: 8000,
  });
  const text = resp.output_text ?? "";
  const json = text.slice(text.indexOf("{"), text.lastIndexOf("}") + 1);
  const parsed = JSON.parse(json || "{}") as { results?: Partial<OnlineJudgment>[] };
  return (parsed.results ?? [])
    .filter((r) => r.title && typeof r.url === "string" && /^https?:\/\//.test(r.url))
    .map((r) => ({
      title: String(r.title),
      court: r.court ? String(r.court) : null,
      date: r.date && /^\d{4}-\d{2}-\d{2}$/.test(String(r.date)) ? String(r.date) : null,
      url: String(r.url),
      summary: r.summary ? String(r.summary) : null,
    }))
    .sort((a, b) => (b.date ?? "").localeCompare(a.date ?? ""));
}
