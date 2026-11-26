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

const RULES = `Never use ASCII art or box-drawing characters. Use markdown tables for tables and numbered lists for diagrams.
Copy numbers, amounts, dates, account numbers, PAN and names exactly as printed; write [illegible] where you cannot read something. Do not add commentary or interpretation.`;

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
