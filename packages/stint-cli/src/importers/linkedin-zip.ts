import type { Readable } from "node:stream";
import { fromBufferPromise, type Entry, type ZipFile } from "yauzl";

import { CliError } from "../diagnostics.js";
import {
  MAX_LINKEDIN_CSV_BYTES,
  parseLinkedInCsv,
} from "./linkedin-csv.js";
import type { ImportResult } from "./json.js";

export const MAX_ZIP_BYTES = 64 * 1024 * 1024;
const MAX_ZIP_ENTRIES = 1_024;
const MAX_ZIP_EXPANDED_BYTES = 64 * 1024 * 1024;
const MAX_COMPRESSION_RATIO = 100;

export async function parseLinkedInZip(
  source: Buffer,
  sourcePath: string,
): Promise<ImportResult> {
  if (source.byteLength > MAX_ZIP_BYTES) {
    throw new CliError("E_IMPORT_LIMIT", "The ZIP input exceeds the archive size limit.", {
      path: sourcePath,
    });
  }
  let zip: ZipFile;
  try {
    zip = await fromBufferPromise(source, {
      autoClose: false,
      decodeStrings: true,
      lazyEntries: true,
      validateEntrySizes: true,
    });
  } catch (error) {
    throw archiveError("The LinkedIn archive is not a valid ZIP file.", sourcePath, error);
  }
  try {
    if (zip.entryCount > MAX_ZIP_ENTRIES) {
      throw new CliError("E_IMPORT_LIMIT", "The ZIP input exceeds the entry limit.", {
        path: sourcePath,
      });
    }
    const names = new Set<string>();
    let expandedBytes = 0;
    let positions: Buffer | undefined;

    for (let index = 0; index < zip.entryCount; index += 1) {
      const entry = await nextEntry(zip, sourcePath);
      const normalizedName = validateEntry(entry, sourcePath);
      const duplicateKey = normalizedName.normalize("NFC").toLocaleLowerCase("en");
      if (names.has(duplicateKey)) {
        throw archiveError("The LinkedIn archive contains a duplicate member.", sourcePath);
      }
      names.add(duplicateKey);
      const isPositions = normalizedName.split("/").at(-1) === "Positions.csv";
      if (isPositions && entry.uncompressedSize > MAX_LINKEDIN_CSV_BYTES) {
        throw new CliError("E_IMPORT_LIMIT", "Positions.csv exceeds the size limit.", {
          path: sourcePath,
        });
      }
      expandedBytes += entry.uncompressedSize;
      if (expandedBytes > MAX_ZIP_EXPANDED_BYTES) {
        throw new CliError("E_IMPORT_LIMIT", "The ZIP input exceeds the expansion limit.", {
          path: sourcePath,
        });
      }
      if (
        entry.uncompressedSize > 0 &&
        entry.uncompressedSize / Math.max(1, entry.compressedSize) > MAX_COMPRESSION_RATIO
      ) {
        throw new CliError(
          "E_IMPORT_LIMIT",
          "The ZIP input exceeds the allowed compression ratio.",
          { path: sourcePath },
        );
      }
      if (isPositions) {
        if (positions) {
          throw archiveError("The LinkedIn archive contains duplicate Positions data.", sourcePath);
        }
        positions = await readEntry(zip, entry, sourcePath);
      }
    }

    if (!positions) {
      throw new CliError("E_IMPORT_SCHEMA", "The LinkedIn archive has no Positions.csv member.", {
        path: sourcePath,
      });
    }
    return parseLinkedInCsv(positions, "Positions.csv");
  } finally {
    zip.close();
  }
}

function validateEntry(entry: Entry, sourcePath: string): string {
  const name = entry.fileName;
  if (
    !name ||
    name.includes("\0") ||
    name.includes("\\") ||
    name.startsWith("/") ||
    /^[A-Za-z]:\//.test(name) ||
    name.split("/").some((segment) => segment === ".." || segment === ".")
  ) {
    throw archiveError("The LinkedIn archive contains an unsafe member path.", sourcePath);
  }
  const unixMode = entry.externalFileAttributes >>> 16;
  const unixType = unixMode & 0o170000;
  const dosAttributes = entry.externalFileAttributes & 0xffff;
  if (unixType === 0o120000 || (dosAttributes & 0x400) !== 0) {
    throw archiveError("The LinkedIn archive contains a symlink member.", sourcePath);
  }
  if (entry.isEncrypted()) {
    throw archiveError("Encrypted ZIP members are not supported.", sourcePath);
  }
  if (entry.compressionMethod !== 0 && entry.compressionMethod !== 8) {
    throw archiveError("The LinkedIn archive uses an unsupported compression method.", sourcePath);
  }
  return name;
}

async function nextEntry(zip: ZipFile, sourcePath: string): Promise<Entry> {
  return new Promise((resolve, reject) => {
    const onEntry = (entry: Entry) => {
      cleanup();
      resolve(entry);
    };
    const onError = (error: Error) => {
      cleanup();
      reject(
        archiveError(
          /invalid relative path|absolute path/i.test(error.message)
            ? "The LinkedIn archive contains an unsafe member path."
            : "The LinkedIn archive could not be read safely.",
          sourcePath,
          error,
        ),
      );
    };
    const cleanup = () => {
      zip.off("entry", onEntry);
      zip.off("error", onError);
    };
    zip.once("entry", onEntry);
    zip.once("error", onError);
    zip.readEntry();
  });
}

async function readEntry(
  zip: ZipFile,
  entry: Entry,
  sourcePath: string,
): Promise<Buffer> {
  let stream: Readable;
  try {
    stream = await zip.openReadStreamPromise(entry);
  } catch (error) {
    throw archiveError("Positions.csv could not be opened safely.", sourcePath, error);
  }
  const chunks: Buffer[] = [];
  let bytes = 0;
  try {
    for await (const chunk of stream) {
      const buffer = Buffer.from(chunk as Buffer);
      bytes += buffer.byteLength;
      if (bytes > MAX_LINKEDIN_CSV_BYTES) {
        stream.destroy();
        throw new CliError("E_IMPORT_LIMIT", "Positions.csv exceeds the size limit.", {
          path: sourcePath,
        });
      }
      chunks.push(buffer);
    }
  } catch (error) {
    if (error instanceof CliError) throw error;
    throw archiveError("Positions.csv could not be read safely.", sourcePath, error);
  }
  return Buffer.concat(chunks, bytes);
}

function archiveError(message: string, path: string, cause?: unknown): CliError {
  return new CliError("E_ARCHIVE", message, { cause, path });
}
