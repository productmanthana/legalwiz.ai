type OpenAI = typeof import("@workspace/integrations-openai-ai-server").openai;

export function aiConfigured(): boolean {
  return !!(process.env.AI_INTEGRATIONS_OPENAI_BASE_URL && process.env.AI_INTEGRATIONS_OPENAI_API_KEY);
}

let client: OpenAI | null = null;
async function getClient(): Promise<OpenAI> {
  if (!client) {
    const mod = await import("@workspace/integrations-openai-ai-server");
    client = mod.openai;
  }
  return client;
}

export const AI_MODEL = "gpt-5.6-terra";

/** Calls the model and parses a JSON object response. Throws on failure; callers surface unavailability explicitly. */
export async function completeJson<T>(system: string, user: string): Promise<T> {
  const openai = await getClient();
  const resp = await openai.chat.completions.create({
    model: AI_MODEL,
    max_completion_tokens: 8192,
    response_format: { type: "json_object" },
    messages: [
      { role: "system", content: system },
      { role: "user", content: user },
    ],
  });
  const text = resp.choices[0]?.message?.content ?? "";
  return JSON.parse(text) as T;
}

export const GUARDRAILS = `You assist advocates, chartered accountants and investigated persons in Indian financial investigations (Karnataka Lokayukta disproportionate-assets cases and Income Tax scrutiny).
Strict rules:
- Never state or imply guilt, innocence, legal liability or the legal validity of any explanation. Say what the records show and what is missing.
- Use only the case data provided. Never invent transactions, amounts, dates, documents or facts.
- Never fabricate legal citations, case names, section numbers or paragraph numbers. You may refer only to legal references supplied in the context, and you must state their verification status. If a reference is "unverified", say it must be verified before reliance.
- Label statements as one of: "Verified fact" (directly from imported records), "User-provided" (manually entered or explanations), "AI suggestion" (your inference), or "Missing information".
- Amounts are Indian Rupees; use Indian digit grouping (e.g. Rs. 1,25,000).`;
