import OpenAI from "openai";

/**
 * Vision model used to read scanned pages and pages containing images, tables or charts.
 * Uses the platform OpenAI integration when provisioned, else OPENAI_API_KEY.
 */
let client: OpenAI | null | undefined;
function getClient(): OpenAI | null {
  if (client === undefined) {
    if (process.env.AI_INTEGRATIONS_OPENAI_API_KEY && process.env.AI_INTEGRATIONS_OPENAI_BASE_URL) {
      client = new OpenAI({ apiKey: process.env.AI_INTEGRATIONS_OPENAI_API_KEY, baseURL: process.env.AI_INTEGRATIONS_OPENAI_BASE_URL });
    } else if (process.env.OPENAI_API_KEY) {
      client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
    } else {
      client = null;
    }
  }
  return client;
}

export function visionConfigured(): boolean {
  return getClient() !== null;
}

const VISION_MODEL = process.env.VISION_MODEL || "gpt-4o";
/** Model for structured reading of scanned pages; dense statement tables need a stronger model than plain OCR. */
const SCAN_MODEL = process.env.SCAN_VISION_MODEL || "gpt-5.6-terra";
/** Reasoning-class models take max_completion_tokens and no temperature. */
const modelParams = (model: string, maxTokens: number) =>
  /^(gpt-4|chatgpt)/.test(model) ? { model, max_tokens: maxTokens, temperature: 0 } : { model, max_completion_tokens: maxTokens };

const RULES = `Never use ASCII art or box-drawing characters. Use markdown tables for tables and numbered lists for diagrams.
Copy numbers, amounts, dates, account numbers, PAN and names exactly as printed; write [illegible] where you cannot read something. Do not add commentary or interpretation.
When any text (printed or handwritten) is in Kannada or another non-English language, transcribe it in its original script and then add a section "**English translation:**" giving a complete, faithful English translation of ALL of that text, including handwritten entries, form labels with their filled values, stamps and seals. Keep names, numbers, amounts and dates exactly as written (transliterate names into English letters). Mark unreadable parts [illegible] in the translation too.`;

/** Full transcription — for scanned pages or image files with no usable text layer. */
const OCR_PROMPT = `You are an OCR expert for Indian financial and legal documents (bank statements, ITRs, sale deeds, notices, affidavits).
Transcribe ALL text on this page exactly as it appears, preserving headings, paragraphs and table structure.
Also describe any stamps, seals, signatures, handwriting, photographs, charts or diagrams in one short line each.
${RULES}
If the page has no readable content, reply exactly: NO_CONTENT`;

/** Visual-only extraction — the page's text layer is already indexed. */
const VISUAL_PROMPT = `You are a document analysis expert. The plain text of this page has already been extracted.
Extract ONLY what text extraction would miss: tables (all rows and columns), charts (type, axes, values), diagrams, forms (labels and filled values), text inside images, stamps, seals, signatures and handwriting.
${RULES}
If the page has nothing beyond plain paragraphs, reply exactly: TEXT_ONLY`;

/** Structured reading of one horizontal strip of a scanned page. */
const STRIP_PROMPT = `You are an OCR expert for Indian financial and legal documents (bank statements, passbooks, pension schedules, ITRs, deeds).
The image is one horizontal strip of a scanned page; neighbouring strips overlap slightly.
Return JSON: {"text": string, "rows": Row[]}.

"rows": every transaction row of a bank statement, passbook or account ledger in the strip, top to bottom, exactly one entry per printed row:
Row = {"date": as printed, "ref": cheque/reference/tran id as printed or "", "particulars": as printed, "debit": number|null, "credit": number|null, "balance": number|null, "kind": "txn"|"brought_forward"|"carried_forward"|"total"}
- Put each amount under the column it is printed in (Debit/Withdrawal vs Credit/Deposit), judged by its horizontal position. When headers are not visible, the usual order is Date, Ref, Particulars, Debit, Credit, Balance.
- Amounts are plain numbers without commas or currency (1,23,456.70 -> 123456.7). Balance is negative when marked DR/Dr/OD, positive for CR or unmarked.
- "Brought Forward", opening balance, "Carried Forward", page totals and grand totals use the matching kind, never "txn".
- Particulars wrapped onto a second line belong to the same row.
- Skip a row only when the strip edge cuts through it so it cannot be read fully (the neighbouring strip has it). Never invent, repeat or merge rows.
- Leave "rows" empty when the strip has no transaction ledger.

"text": Markdown transcription of everything else in the strip: headings, names, account details, notes, footers, and every table that is NOT a transaction ledger (as a Markdown table with all rows and columns, e.g. pension or salary schedules). Do not repeat the transaction rows here. Describe stamps, seals, signatures and handwriting in one short line each.

${RULES}
If the strip has no readable content return {"text": "", "rows": []}.`;

export type StripRead = { text: string; rows: Record<string, unknown>[] };

/** Reads one strip of a scanned page into transcribed text plus transaction rows. Throws on API failure. */
export async function readPageStrip(image: Buffer, mimeType: string, label: string): Promise<StripRead> {
  const ai = getClient();
  if (!ai) throw new Error("Vision model not configured");
  const resp = await ai.chat.completions.create({
    ...modelParams(SCAN_MODEL, 32000),
    response_format: { type: "json_object" },
    messages: [
      { role: "system", content: STRIP_PROMPT },
      {
        role: "user",
        content: [
          { type: "image_url", image_url: { url: `data:${mimeType};base64,${image.toString("base64")}`, detail: "high" } },
          { type: "text", text: `Read ${label}.` },
        ],
      },
    ],
  });
  const choice = resp.choices[0];
  if (choice?.finish_reason === "length") throw new Error("the vision model's answer was cut off (page too dense)");
  const out = JSON.parse(choice?.message?.content || "{}") as Partial<StripRead>;
  return { text: typeof out.text === "string" ? out.text : "", rows: Array.isArray(out.rows) ? out.rows : [] };
}

export type VisionMode = "ocr" | "visual";

/** Returns extracted markdown, or null when the model found nothing beyond plain text. Throws on API failure. */
export async function readPageImage(image: Buffer, mimeType: string, mode: VisionMode): Promise<string | null> {
  const ai = getClient();
  if (!ai) throw new Error("Vision model not configured");
  const resp = await ai.chat.completions.create({
    model: VISION_MODEL,
    max_tokens: 4096,
    temperature: 0,
    messages: [
      { role: "system", content: mode === "ocr" ? OCR_PROMPT : VISUAL_PROMPT },
      {
        role: "user",
        content: [
          { type: "image_url", image_url: { url: `data:${mimeType};base64,${image.toString("base64")}`, detail: "high" } },
          { type: "text", text: mode === "ocr" ? "Transcribe this page." : "Extract the visual and structured content of this page." },
        ],
      },
    ],
  });
  const out = resp.choices[0]?.message?.content?.trim();
  if (!out || out === "TEXT_ONLY" || out === "NO_CONTENT") return null;
  return out;
}
