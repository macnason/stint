import { parentPort, workerData } from "node:worker_threads";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { PDFiumLibrary } from "@hyzyla/pdfium";
import { createWorker, type Worker } from "tesseract.js";
import { encode as encodePng } from "fast-png";
import { decodeRaster, findScreenshotSlots } from "../logos/raster.js";
import { EMPLOYER_BREAK } from "./layout.js";

// Bundled as CJS so all assets resolve within the installed CLI, including in npx.
declare const __dirname: string;
const MAX_PIXELS = 16_000_000;
let ocr: Worker | undefined;
async function worker() {
  ocr ??= await createWorker("eng", 1, {
    workerPath: join(__dirname, "ocr.cjs"),
    langPath: __dirname,
    cacheMethod: "none",
    gzip: true,
    errorHandler: () => {},
  });
  return ocr;
}
async function recognize(image: Uint8Array) {
  const result = await (await worker()).recognize(Buffer.from(image));
  return { text: result.data.text, confidence: result.data.confidence };
}

/**
 * Reads a LinkedIn screenshot using its layout. Each employer has one logo slot down
 * the left edge: words inside that column are logo artwork, not text, and each slot
 * starts a new employer, which keeps grouped roles with their company.
 */
async function recognizeScreenshot(image: Uint8Array) {
  const raster = decodeRaster(image);
  const slots = raster ? findScreenshotSlots(raster) : [];
  if (slots.length < 2) return recognize(image);
  const textLeft = slots[0]!.x + slots[0]!.size;
  // Paint the logo column white so OCR never reads artwork in the context of a line.
  const data = new Uint8Array(raster!.data);
  for (let y = 0; y < raster!.height; y++)
    data.fill(255, y * raster!.width * 4, (y * raster!.width + Math.min(textLeft, raster!.width)) * 4);
  const masked = encodePng({ width: raster!.width, height: raster!.height, data, channels: 4 });
  const result = await (await worker()).recognize(Buffer.from(masked), {}, { blocks: true });
  const lines = (result.data.blocks ?? [])
    .flatMap((block) => block.paragraphs.flatMap((paragraph) => paragraph.lines))
    .map((line) => ({
      top: line.bbox.y0,
      text: line.words
        .filter((word) => (word.bbox.x0 + word.bbox.x1) / 2 > textLeft)
        .map((word) => word.text)
        .join(" ")
        .trim(),
    }))
    .filter((line) => line.text)
    .sort((a, b) => a.top - b.top);
  const out: string[] = [];
  let next = 0;
  for (const line of lines) {
    // A slot's first text line sits level with the top of its logo.
    while (next < slots.length && line.top >= slots[next]!.y - slots[next]!.size * 0.25) {
      out.push(EMPLOYER_BREAK);
      next++;
    }
    out.push(line.text);
  }
  return { text: out.join("\n"), confidence: result.data.confidence };
}

// Leptonica reads PGM directly; no canvas or image-encoding dependency is needed.
function pgm(data: Uint8Array, width: number, height: number) {
  return Buffer.concat([Buffer.from(`P5\n${width} ${height}\n255\n`), data]);
}
async function extract() {
  const source = new Uint8Array(workerData.source);
  if (workerData.format === "image")
    return [{ ...(await recognizeScreenshot(source)), method: "ocr" }];
  const binary = readFileSync(join(__dirname, "pdfium.wasm"));
  const library = await PDFiumLibrary.init({
    wasmBinary: Uint8Array.from(binary).buffer,
  });
  try {
    const document = await library.loadDocument(source);
    try {
      if (document.getPageCount() > 20) throw new Error("limit");
      const pages = [];
      for (const page of document.pages()) {
        const text = page.getText();
        if (text.replace(/\s/g, "").length >= 40) {
          pages.push({ text, method: "text" });
          continue;
        }
        const { originalWidth: width, originalHeight: height } =
          page.getOriginalSize();
        if (
          !Number.isFinite(width * height) ||
          width <= 0 ||
          height <= 0 ||
          width * height * 9 > MAX_PIXELS
        )
          throw new Error("limit");
        const rendered = await page.render({
          scale: 3,
          colorSpace: "Gray",
          renderFormFields: false,
        });
        pages.push({
          ...(await recognize(
            pgm(rendered.data, rendered.width, rendered.height)
          )),
          method: "ocr",
        });
      }
      return pages;
    } finally {
      document.destroy();
    }
  } finally {
    library.destroy();
  }
}
async function main() {
  let result: unknown;
  try {
    const pages = await extract();
    if (pages.reduce((n, page) => n + page.text.length, 0) > 1_000_000)
      throw new Error("limit");
    result = { pages };
  } catch (error) {
    result = {
      error:
        error instanceof Error && error.message === "limit" ? "limit" : "parse",
    };
  } finally {
    await ocr?.terminate();
  }
  parentPort!.postMessage(result);
}
void main();
