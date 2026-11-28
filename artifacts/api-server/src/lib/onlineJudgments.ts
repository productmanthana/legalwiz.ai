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

export type ChatTurn = { role: "user" | "assistant"; content: string };
export type JudgmentContext = { title: string; court?: string | null; date?: string | null; url?: string | null; summary?: string | null };

/**
 * Multi-turn chat about court judgments with live web search.
 * When a judgment is given, the conversation is about that judgment.
 */
export async function judgmentChat(messages: ChatTurn[], judgment?: JudgmentContext): Promise<{ answer: string; sources: { title: string; url: string }[] }> {
  const openai = getClient();
  if (!openai) throw new Error("AI is not configured");
  const today = new Date().toISOString().slice(0, 10);
  const focus = judgment
    ? `\n\nThe user is asking about this judgment:\nTitle: ${judgment.title}\nCourt: ${judgment.court ?? "unknown"}\nDate: ${judgment.date ?? "unknown"}\nLink: ${judgment.url ?? "none"}\nSummary: ${judgment.summary ?? "none"}\nSearch the web (open the link when available) to read it before answering.`
    : "";
  const resp = await openai.responses.create({
    model: SEARCH_MODEL,
    tools: [{ type: "web_search" }],
    instructions:
      `You are a legal research assistant for Indian law (Prevention of Corruption Act, Karnataka Lokayukta, disproportionate assets, Income-tax). Today is ${today}. ` +
      "Use web search for every question so answers reflect current judgments, including recent ones. Answer in clear markdown: facts, issues, holding, reasoning and relevance as applicable. " +
      "Name cases with court and date and link to the source pages you found. Never invent cases, citations, paragraphs or links; say so when something could not be confirmed. " +
      "End with a one-line reminder to verify against the official judgment before relying on it." + focus,
    input: messages.slice(-20).map((m) => ({ role: m.role, content: m.content })),
    max_output_tokens: 8000,
  });
  const sources = new Map<string, string>();
  for (const item of resp.output) {
    if (item.type !== "message") continue;
    for (const c of item.content) {
      if (c.type !== "output_text") continue;
      for (const a of c.annotations ?? []) if (a.type === "url_citation") sources.set(a.url, a.title || a.url);
    }
  }
  return { answer: resp.output_text ?? "", sources: [...sources].map(([url, title]) => ({ url, title })) };
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
