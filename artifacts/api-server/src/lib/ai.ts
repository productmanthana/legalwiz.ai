import type { Response as AiResponse, ResponseInput } from "openai/resources/responses/responses";

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

export type AiTool = { name: string; description: string; parameters: Record<string, unknown>; run: (args: Record<string, unknown>) => unknown };

/**
 * Like completeJson, but the model may call tools (e.g. exact totals computed in code)
 * before giving its final JSON answer.
 */
export async function completeJsonWithTools<T>(system: string, user: string, tools: AiTool[], maxRounds = 8): Promise<T> {
  const openai = await getClient();
  const fnTools = tools.map((t) => ({ type: "function" as const, name: t.name, description: t.description, parameters: t.parameters, strict: false }));
  let previous: string | undefined;
  // json_object output requires the word "json" in each round's input.
  let input: string | ResponseInput = `${user}\n\nReply with the JSON object described.`;
  for (let round = 0; round < maxRounds; round++) {
    // Responses API: the model keeps its reasoning between tool calls via previous_response_id.
    const resp: AiResponse = await openai.responses.create({
      model: AI_MODEL,
      instructions: system,
      input,
      previous_response_id: previous,
      tools: fnTools,
      tool_choice: round === maxRounds - 1 ? "none" : "auto",
      text: { format: { type: "json_object" } },
      max_output_tokens: 32000,
    });
    const calls = resp.output.filter((o) => o.type === "function_call");
    if (calls.length === 0) return JSON.parse(resp.output_text) as T;
    const outputs: ResponseInput = [];
    for (const c of calls) {
      const tool = tools.find((t) => t.name === c.name);
      let result: unknown;
      try {
        result = tool ? await tool.run(JSON.parse(c.arguments || "{}")) : { error: `Unknown tool ${c.name}` };
      } catch (err) {
        result = { error: err instanceof Error ? err.message : String(err) };
      }
      outputs.push({ type: "function_call_output", call_id: c.call_id, output: JSON.stringify(result) });
    }
    outputs.push({ role: "user", content: "Tool results above. Continue; the final reply must be the JSON object." });
    previous = resp.id;
    input = outputs;
  }
  throw new Error("The model did not finish its answer.");
}

export const GUARDRAILS = `You assist advocates, chartered accountants and investigated persons in Indian financial investigations (Karnataka Lokayukta disproportionate-assets cases and Income Tax scrutiny).
Strict rules:
- Never state or imply guilt, innocence, legal liability or the legal validity of any explanation. Say what the records show and what is missing.
- Use only the case data provided. Never invent transactions, amounts, dates, documents or facts.
- Never fabricate legal citations, case names, section numbers or paragraph numbers. You may refer only to legal references supplied in the context, and you must state their verification status. If a reference is "unverified", say it must be verified before reliance.
- Label statements as one of: "Verified fact" (directly from imported records), "User-provided" (manually entered or explanations), "AI suggestion" (your inference), or "Missing information".
- Amounts are Indian Rupees; use Indian digit grouping (e.g. Rs. 1,25,000).`;
