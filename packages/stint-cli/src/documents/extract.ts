import { Worker } from "node:worker_threads";
import { CliError } from "../diagnostics.js";
import { parseDocumentHistory } from "./history.js";
import type { ImportResult } from "../importers/json.js";

interface Page {
  text: string;
  method: "text" | "ocr";
  confidence?: number;
}
export async function extractDocument(
  source: Buffer,
  format: "pdf" | "image"
): Promise<ImportResult> {
  if (format === "pdf" && !source.subarray(0, 5).equals(Buffer.from("%PDF-")))
    throw new CliError(
      "E_IMPORT_PARSE",
      "The file is not a valid PDF. Export it again from LinkedIn."
    );
  if (format === "image") checkImage(source);
  const pages = await new Promise<Page[]>((resolve, reject) => {
    const worker = new Worker(
      new URL("../../dist/documents/engine.cjs", import.meta.url),
      { workerData: { source, format }, stdout: true, stderr: true }
    );
    const timer = setTimeout(
      () =>
        finish(
          new CliError(
            "E_IMPORT_LIMIT",
            "Document extraction exceeded 90 seconds. Try fewer pages or a smaller screenshot."
          )
        ),
      90_000
    );
    let finished = false;
    function finish(error?: Error, pages?: Page[]) {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      void worker.terminate();
      if (error) reject(error);
      else resolve(pages!);
    }
    worker.stdout.resume();
    worker.stderr.resume();
    worker.once("message", (result: { pages?: Page[]; error?: string }) => {
      if (result.pages) finish(undefined, result.pages);
      else
        finish(
          new CliError(
            result.error === "limit" ? "E_IMPORT_LIMIT" : "E_IMPORT_PARSE",
            result.error === "limit"
              ? "Document exceeds the 20-page or 16-megapixel page limit. Split it into smaller files."
              : "Could not read this document. Try an unlocked PDF or a clear PNG/JPEG screenshot."
          )
        );
    });
    worker.once("error", () =>
      finish(
        new CliError(
          "E_IMPORT_PARSE",
          "The bundled document engine could not start. Reinstall the CLI and try again."
        )
      )
    );
    worker.once("exit", () => {
      if (!finished)
        finish(
          new CliError(
            "E_IMPORT_PARSE",
            "Document extraction stopped before completion. Try a smaller file."
          )
        );
    });
  });
  const result = parseDocumentHistory(
    pages.map((p) => p.text).join("\n"),
    format
  );
  return {
    ...result,
    extraction: {
      pages: pages.length,
      ocrPages: pages.filter((p) => p.method === "ocr").length,
    },
    warnings: [
      ...result.warnings,
      ...pages.flatMap((p, i) =>
        p.confidence !== undefined && p.confidence < 80
          ? [
              {
                code: "document-low-confidence",
                message: `OCR confidence on page ${i + 1} is ${Math.round(
                  p.confidence
                )}%; review carefully or use a clearer image.`,
                path: `document.pages[${i}]`,
                severity: "warning" as const,
              },
            ]
          : []
      ),
    ],
  };
}

function checkImage(source: Buffer) {
  let width = 0,
    height = 0;
  if (
    source.length >= 24 &&
    source.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
  ) {
    width = source.readUInt32BE(16);
    height = source.readUInt32BE(20);
  } else if (source[0] === 0xff && source[1] === 0xd8) {
    let offset = 2;
    while (offset + 4 <= source.length) {
      if (source[offset] !== 0xff) break;
      const marker = source[offset + 1]!;
      if (marker === 0xff) {
        offset++;
        continue;
      }
      if (marker === 0xda || marker === 0xd9) break;
      const length = source.readUInt16BE(offset + 2);
      if (length < 2 || offset + 2 + length > source.length) break;
      if ([0xc0, 0xc1, 0xc2].includes(marker) && length >= 7) {
        height = source.readUInt16BE(offset + 5);
        width = source.readUInt16BE(offset + 7);
        break;
      }
      offset += length + 2;
    }
  }
  if (!width || !height)
    throw new CliError("E_IMPORT_PARSE", "Use a valid PNG or JPEG screenshot.");
  if (width * height > 16_000_000)
    throw new CliError(
      "E_IMPORT_LIMIT",
      "Screenshot exceeds 16 megapixels. Crop it to the Experience section."
    );
}
