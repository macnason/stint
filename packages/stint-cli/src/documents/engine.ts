import { parentPort, workerData } from "node:worker_threads";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { PDFiumLibrary } from "@hyzyla/pdfium";
import { createWorker, type Worker } from "tesseract.js";

// Bundled as CJS so all assets resolve within the installed CLI, including in npx.
declare const __dirname: string;
const MAX_PIXELS = 16_000_000;
let ocr: Worker | undefined;
async function recognize(image: Uint8Array) {
  ocr ??= await createWorker("eng", 1, {
    workerPath: join(__dirname, "ocr.cjs"),
    langPath: __dirname,
    cacheMethod: "none",
    gzip: true,
    errorHandler: () => {},
  });
  const result = await ocr.recognize(Buffer.from(image));
  return { text: result.data.text, confidence: result.data.confidence };
}

// Leptonica reads PGM directly; no canvas or image-encoding dependency is needed.
function pgm(data: Uint8Array, width: number, height: number) {
  return Buffer.concat([Buffer.from(`P5\n${width} ${height}\n255\n`), data]);
}
async function extract() {
  const source = new Uint8Array(workerData.source);
  if (workerData.format === "image")
    return [{ ...(await recognize(source)), method: "ocr" }];
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
