import { execFile } from "node:child_process";
import { promisify } from "node:util";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import * as XLSX from "xlsx";
import mammoth from "mammoth";
import { readPageImage, visionConfigured } from "./vision";

const run = promisify(execFile);

/**
 * Turns an uploaded file into page-level text.
 *  - Plain text / CSV / spreadsheets / Word without images: text is read directly.
 *  - PDF: each page's text layer is used; pages that are scanned (no text) or carry
 *    images are rendered to PNG and read by the vision model.
 *  - Word with images and other office formats: converted to PDF (LibreOffice), then as PDF.
 *  - Image files: read by the vision model.
 */
export type PageMethod = "text" | "vision" | "mixed";
export type ExtractedPage = { pageNumber: number; text: string; method: PageMethod };
export type Extraction = { kind: FileKind; pages: ExtractedPage[]; warnings: string[] };
export type FileKind = "text" | "spreadsheet" | "pdf" | "word" | "office" | "image" | "unsupported";

const TEXT_EXT = new Set(["txt", "text", "md", "csv", "tsv", "json", "log", "xml", "html", "htm"]);
const SHEET_EXT = new Set(["xlsx", "xls", "xlsm", "ods"]);
const OFFICE_EXT = new Set(["doc", "rtf", "odt", "ppt", "pptx", "odp"]);
const IMAGE_MIME: Record<string, string> = { png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", webp: "image/webp", gif: "image/gif" };

/** A page with fewer characters than this in its text layer is treated as scanned. */
const MIN_TEXT_CHARS = 40;
/** Embedded images smaller than this (px) are ignored — logos, rules, bullets. */
const MIN_IMAGE_W = 300;
const MIN_IMAGE_H = 200;
const MAX_VISION_PAGES = Number(process.env.MAX_VISION_PAGES_PER_DOCUMENT || 500);
const VISION_CONCURRENCY = 3;

export function detectKind(name: string, contentType: string, buf: Buffer): FileKind {
  const ext = name.split(".").pop()?.toLowerCase() ?? "";
  const head = buf.subarray(0, 8);
  if (head.subarray(0, 4).toString("latin1") === "%PDF") return "pdf";
  if (head[0] === 0x89 && head.subarray(1, 4).toString("latin1") === "PNG") return "image";
  if (head[0] === 0xff && head[1] === 0xd8) return "image";
  if (head.subarray(0, 3).toString("latin1") === "GIF") return "image";
  if (head.subarray(0, 4).toString("latin1") === "RIFF" && buf.subarray(8, 12).toString("latin1") === "WEBP") return "image";
  if (ext === "docx" || contentType.includes("wordprocessingml")) return "word";
  if (SHEET_EXT.has(ext) || contentType.includes("spreadsheet") || contentType.includes("ms-excel")) return "spreadsheet";
  if (OFFICE_EXT.has(ext)) return "office";
  if (TEXT_EXT.has(ext) || contentType.startsWith("text/")) return "text";
  // Unknown extension: accept it as text when it has no NUL bytes in the first 4 KB.
  if (!buf.subarray(0, 4096).includes(0)) return "text";
  return "unsupported";
}

export async function extractDocument(buf: Buffer, name: string, contentType: string): Promise<Extraction> {
  const kind = detectKind(name, contentType, buf);
  const warnings: string[] = [];
  switch (kind) {
    case "text":
      return { kind, pages: [{ pageNumber: 1, text: buf.toString("utf8"), method: "text" }], warnings };
    case "spreadsheet":
      return { kind, pages: spreadsheetPages(buf), warnings };
    case "pdf":
      return { kind, pages: await pdfPages(buf, warnings), warnings };
    case "image": {
      if (!visionConfigured()) throw new Error("Image files need the vision model, which is not configured (set OPENAI_API_KEY).");
      const ext = name.split(".").pop()?.toLowerCase() ?? "";
      const mime = contentType.startsWith("image/") ? contentType : IMAGE_MIME[ext] ?? "image/png";
      const text = await readPageImage(buf, mime, "ocr");
      return { kind, pages: text ? [{ pageNumber: 1, text, method: "vision" }] : [], warnings };
    }
    case "word": {
      if (!(await wordHasImages(buf))) {
        const { value } = await mammoth.extractRawText({ buffer: buf });
        return { kind, pages: [{ pageNumber: 1, text: value, method: "text" }], warnings };
      }
      const pdf = await convertToPdf(buf, "docx");
      if (pdf) return { kind, pages: await pdfPages(pdf, warnings), warnings };
      warnings.push("The document contains images but LibreOffice is not installed, so only its text was indexed.");
      const { value } = await mammoth.extractRawText({ buffer: buf });
      return { kind, pages: [{ pageNumber: 1, text: value, method: "text" }], warnings };
    }
    case "office": {
      const pdf = await convertToPdf(buf, name.split(".").pop()!.toLowerCase());
      if (!pdf) throw new Error("This format needs LibreOffice for conversion, which is not installed on the server.");
      return { kind, pages: await pdfPages(pdf, warnings), warnings };
    }
    default:
      throw new Error("Unsupported file type for indexing.");
  }
}

function spreadsheetPages(buf: Buffer): ExtractedPage[] {
  const wb = XLSX.read(buf, { type: "buffer", cellDates: true });
  return wb.SheetNames.map((sheet, i) => ({
    pageNumber: i + 1,
    text: `Sheet: ${sheet}\n${XLSX.utils.sheet_to_csv(wb.Sheets[sheet]!, { blankrows: false })}`,
    method: "text" as const,
  }));
}

async function wordHasImages(buf: Buffer): Promise<boolean> {
  let images = 0;
  await mammoth.convertToHtml(
    { buffer: buf },
    { convertImage: mammoth.images.imgElement(async () => { images++; return { src: "" }; }) },
  );
  return images > 0;
}

async function withTmp<T>(fn: (dir: string) => Promise<T>): Promise<T> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "fintrace-doc-"));
  try {
    return await fn(dir);
  } finally {
    await fs.rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}

async function hasBinary(bin: string): Promise<boolean> {
  try {
    await run("which", [bin]);
    return true;
  } catch {
    return false;
  }
}

async function convertToPdf(buf: Buffer, ext: string): Promise<Buffer | null> {
  const bin = (await hasBinary("soffice")) ? "soffice" : (await hasBinary("libreoffice")) ? "libreoffice" : null;
  if (!bin) return null;
  return withTmp(async (dir) => {
    const input = path.join(dir, `input.${ext}`);
    await fs.writeFile(input, buf);
    await run(bin, ["--headless", "--convert-to", "pdf", "--outdir", dir, input], { timeout: 180_000, env: { ...process.env, HOME: dir } });
    return fs.readFile(path.join(dir, "input.pdf"));
  });
}

/** Pages (1-based) that carry at least one meaningful embedded image, from `pdfimages -list`. */
async function pagesWithImages(pdfPath: string): Promise<Set<number>> {
  const pages = new Set<number>();
  const { stdout } = await run("pdfimages", ["-list", pdfPath], { maxBuffer: 64 * 1024 * 1024 });
  for (const line of stdout.split("\n").slice(2)) {
    const cols = line.trim().split(/\s+/);
    const page = Number(cols[0]);
    const w = Number(cols[3]);
    const h = Number(cols[4]);
    if (page && w >= MIN_IMAGE_W && h >= MIN_IMAGE_H) pages.add(page);
  }
  return pages;
}

async function renderPage(pdfPath: string, dir: string, page: number): Promise<Buffer> {
  const out = path.join(dir, `p${page}`);
  await run("pdftoppm", ["-png", "-r", "150", "-f", String(page), "-l", String(page), "-singlefile", pdfPath, out], { timeout: 120_000 });
  const file = `${out}.png`;
  const img = await fs.readFile(file);
  await fs.rm(file, { force: true });
  return img;
}

async function pdfPages(pdf: Buffer, warnings: string[]): Promise<ExtractedPage[]> {
  if (!(await hasBinary("pdftotext"))) throw new Error("PDF tools (poppler-utils) are not installed on the server.");
  return withTmp(async (dir) => {
    const pdfPath = path.join(dir, "input.pdf");
    await fs.writeFile(pdfPath, pdf);
    const { stdout } = await run("pdftotext", ["-layout", "-enc", "UTF-8", pdfPath, "-"], { maxBuffer: 512 * 1024 * 1024, timeout: 300_000 });
    // pdftotext separates pages with form feeds; the last element after the final \f is empty.
    const texts = stdout.split("\f");
    if (texts.length > 1 && texts[texts.length - 1]!.trim() === "") texts.pop();
    const imagePages = await pagesWithImages(pdfPath).catch(() => new Set<number>());

    const pages: ExtractedPage[] = texts.map((t, i) => ({ pageNumber: i + 1, text: t, method: "text" }));
    const needsVision = pages.filter((p) => p.text.trim().length < MIN_TEXT_CHARS || imagePages.has(p.pageNumber));
    if (needsVision.length === 0) return pages;

    if (!visionConfigured()) {
      warnings.push(`${needsVision.length} page(s) are scanned or contain images but the vision model is not configured; only their text layer was indexed.`);
      return pages;
    }
    const queue = needsVision.slice(0, MAX_VISION_PAGES);
    if (needsVision.length > queue.length) warnings.push(`Vision reading was limited to ${MAX_VISION_PAGES} pages; ${needsVision.length - queue.length} page(s) used only their text layer.`);

    let failed = 0;
    let firstError = "";
    let next = 0;
    const worker = async () => {
      while (next < queue.length) {
        const page = queue[next++]!;
        const scanned = page.text.trim().length < MIN_TEXT_CHARS;
        try {
          const img = await renderPage(pdfPath, dir, page.pageNumber);
          const out = await readPageImage(img, "image/png", scanned ? "ocr" : "visual");
          if (scanned) {
            if (out) {
              page.text = out;
              page.method = "vision";
            }
          } else if (out) {
            page.text = `${page.text}\n\n[Visual content on this page]\n${out}`;
            page.method = "mixed";
          }
        } catch (err) {
          failed++;
          firstError ||= visionErrorReason(err);
        }
      }
    };
    await Promise.all(Array.from({ length: VISION_CONCURRENCY }, worker));
    if (failed) warnings.push(`Vision reading failed on ${failed} page(s) (${firstError}); their text layer (if any) was indexed.`);
    return pages;
  });
}

/** Short, user-facing reason for a vision API failure (never includes the key itself). */
function visionErrorReason(err: unknown): string {
  const status = (err as { status?: number })?.status;
  if (status === 401) return "the OpenAI API key was rejected — update OPENAI_API_KEY";
  if (status === 429) return "OpenAI rate limit or quota exceeded";
  if (status === 404) return "the vision model is not available for this API key";
  return err instanceof Error ? err.message.slice(0, 160) : "unknown error";
}
