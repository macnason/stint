// Raster decoding and LinkedIn screenshot slot detection. Shared by the logo engine and
// document extraction, so it must not import the vector renderer.
import { decode as decodePngFile } from "fast-png";
import jpeg from "jpeg-js";
import type { LogoChoice } from "./types.js";

export const MAX_PIXELS = 16_000_000;

export interface Raster {
  readonly width: number;
  readonly height: number;
  /** Straight (non-premultiplied) RGBA. */
  readonly data: Uint8Array;
  readonly format: LogoChoice["format"];
}

/** Decodes PNG, JPEG and ICO bytes; other formats return undefined. */
export function decodeRaster(bytes: Uint8Array): Raster | undefined {
  try {
    if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e) return decodePng(bytes);
    if (bytes[0] === 0xff && bytes[1] === 0xd8) {
      const image = jpeg.decode(bytes, {
        useTArray: true,
        formatAsRGBA: true,
        maxResolutionInMP: MAX_PIXELS / 1e6,
        maxMemoryUsageInMB: 256,
      });
      return { width: image.width, height: image.height, data: image.data, format: "jpeg" };
    }
    if (bytes[0] === 0 && bytes[1] === 0 && bytes[2] === 1 && bytes[3] === 0) return decodeIco(bytes);
  } catch {
    // Unreadable images are rejected by the caller.
  }
  return undefined;
}

function decodePng(bytes: Uint8Array): Raster {
  const png = decodePngFile(bytes);
  if (png.width * png.height > MAX_PIXELS) throw new Error("too large");
  const { width, height } = png;
  const out = new Uint8Array(width * height * 4);
  if (png.palette) {
    for (let i = 0; i < width * height; i += 1) {
      const color = png.palette[png.data[i] as number] ?? [0, 0, 0, 0];
      out[i * 4] = color[0]!;
      out[i * 4 + 1] = color[1]!;
      out[i * 4 + 2] = color[2]!;
      out[i * 4 + 3] = color[3] ?? 255;
    }
    return { width, height, data: out, format: "png" };
  }
  const channels = png.channels;
  const depth = png.depth;
  let samples: ArrayLike<number> = png.data;
  if (depth < 8) {
    // fast-png leaves sub-byte samples packed; expand each row to one byte per sample.
    const rowBytes = Math.ceil((width * channels * depth) / 8);
    const max = (1 << depth) - 1;
    const unpacked = new Uint8Array(width * height * channels);
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width * channels; x += 1) {
        const bit = x * depth;
        const byte = (png.data as Uint8Array)[y * rowBytes + (bit >> 3)]!;
        const value = (byte >> (8 - depth - (bit & 7))) & max;
        unpacked[y * width * channels + x] = Math.round((value / max) * 255);
      }
    }
    samples = unpacked;
  }
  const shift = depth === 16 ? 8 : 0;
  for (let i = 0; i < width * height; i += 1) {
    const sample = (k: number) => (samples[i * channels + k]! >> shift) & 0xff;
    const [r, g, b, a] =
      channels === 1
        ? [sample(0), sample(0), sample(0), 255]
        : channels === 2
          ? [sample(0), sample(0), sample(0), sample(1)]
          : channels === 3
            ? [sample(0), sample(1), sample(2), 255]
            : [sample(0), sample(1), sample(2), sample(3)];
    out.set([r, g, b, a], i * 4);
  }
  return { width, height, data: out, format: "png" };
}

function decodeIco(bytes: Uint8Array): Raster | undefined {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const count = view.getUint16(4, true);
  const entries = [];
  for (let i = 0; i < Math.min(count, 64); i += 1) {
    const base = 6 + i * 16;
    if (base + 16 > bytes.length) break;
    entries.push({
      width: bytes[base] || 256,
      size: view.getUint32(base + 8, true),
      offset: view.getUint32(base + 12, true),
    });
  }
  entries.sort((a, b) => b.width - a.width);
  for (const entry of entries) {
    if (entry.offset + entry.size > bytes.length) continue;
    const image = bytes.subarray(entry.offset, entry.offset + entry.size);
    if (image[0] === 0x89 && image[1] === 0x50) return { ...decodePng(image), format: "ico" };
    const bmp = decodeIcoBitmap(image);
    if (bmp) return bmp;
  }
  return undefined;
}

function decodeIcoBitmap(image: Uint8Array): Raster | undefined {
  // Only 32-bit BGRA bitmaps carry usable alpha; older palette icons are too small to matter.
  const view = new DataView(image.buffer, image.byteOffset, image.byteLength);
  const headerSize = view.getUint32(0, true);
  const width = view.getInt32(4, true);
  const height = Math.abs(view.getInt32(8, true)) / 2;
  const bits = view.getUint16(14, true);
  if (bits !== 32 || width <= 0 || width > 512 || height <= 0) return undefined;
  const data = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const src = headerSize + ((height - 1 - y) * width + x) * 4;
      const dst = (y * width + x) * 4;
      data[dst] = image[src + 2]!;
      data[dst + 1] = image[src + 1]!;
      data[dst + 2] = image[src]!;
      data[dst + 3] = image[src + 3]!;
    }
  }
  return { width, height, data, format: "bmp" };
}

/* ---------------- LinkedIn screenshots ---------------- */

const PLACEHOLDER_PALETTE = [
  [224, 224, 216],
  [160, 176, 192],
  [120, 136, 160],
  [88, 96, 120],
] as const;

export interface ScreenshotSlot {
  readonly x: number;
  readonly y: number;
  readonly size: number;
  readonly placeholder: boolean;
}

/**
 * Finds the square logo slots down the left edge of a LinkedIn Experience screenshot.
 * Slots are returned top to bottom, matching the order of employers on the page.
 */
export function findScreenshotSlots(image: Raster): ScreenshotSlot[] {
  const { width: w, height: h, data } = image;
  const band = Math.round(w * 0.18);
  // Paper is the screenshot's own background: the dominant colours in the left band
  // (white card, warm grey page). Logo boxes in near-white still count as content.
  const counts = new Map<number, number>();
  for (let y = 0; y < h; y += 4)
    for (let x = 0; x < band; x += 4) {
      const i = (y * w + x) * 4;
      const key = (data[i]! << 16) | (data[i + 1]! << 8) | data[i + 2]!;
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
  const samples = Math.ceil(h / 4) * Math.ceil(band / 4);
  const paper = [...counts]
    .filter(([, n]) => n > samples * 0.08)
    .map(([key]) => [(key >> 16) & 255, (key >> 8) & 255, key & 255] as const);
  const isPaper = (i: number) =>
    data[i + 3]! < 20 ||
    paper.some((c) => Math.abs(data[i]! - c[0]) + Math.abs(data[i + 1]! - c[1]) + Math.abs(data[i + 2]! - c[2]) <= 6);
  const seen = new Uint8Array(w * h);
  const blobs: { x0: number; y0: number; x1: number; y1: number; n: number }[] = [];
  for (let y = 0; y < h; y += 1) {
    for (let x = 0; x < band; x += 1) {
      const start = y * w + x;
      if (seen[start] || isPaper(start * 4)) continue;
      seen[start] = 1;
      const stack = [start];
      let x0 = x, x1 = x, y0 = y, y1 = y, n = 0;
      while (stack.length) {
        const p = stack.pop()!;
        const px = p % w, py = (p - px) / w;
        n += 1;
        if (px < x0) x0 = px;
        if (px > x1) x1 = px;
        if (py < y0) y0 = py;
        if (py > y1) y1 = py;
        for (const q of [p + 1, p - 1, p + w, p - w]) {
          const qx = q % w;
          if (q < 0 || q >= w * h || qx >= band || Math.abs(qx - px) > 1 || seen[q] || isPaper(q * 4)) continue;
          seen[q] = 1;
          stack.push(q);
        }
      }
      // Very tall blobs are page gutters or dividers, not logos.
      if (y1 - y0 < w * 0.12 && x1 - x0 < w * 0.12) blobs.push({ x0, y0, x1, y1, n });
    }
  }
  // The modal square size and column of large near-square blobs define the logo slot.
  const squares = blobs.filter((b) => {
    const bw = b.x1 - b.x0 + 1, bh = b.y1 - b.y0 + 1;
    return bw > w * 0.035 && bw < w * 0.09 && Math.abs(bw - bh) <= Math.max(3, bw * 0.06);
  });
  if (squares.length < 2) return [];
  const mode = (values: number[]) => {
    const counts = new Map<number, number>();
    for (const v of values) counts.set(v, (counts.get(v) ?? 0) + 1);
    return [...counts].sort((a, b) => b[1] - a[1])[0]![0];
  };
  const size = mode(squares.map((b) => b.x1 - b.x0 + 1));
  const column = mode(squares.filter((b) => b.x1 - b.x0 + 1 === size).map((b) => b.x0));
  const slotFor = (y: number) => ({ x: column, y: Math.max(0, Math.min(h - size, Math.round(y))), size });
  // 1. Boxed logos (and LinkedIn placeholders) are exact slot-sized squares.
  const strong = squares
    .filter((b) => Math.abs(b.x1 - b.x0 + 1 - size) <= Math.max(3, size * 0.06) && Math.abs(b.x0 - column) <= 3)
    .map((b) => slotFor(b.y0));
  const taken = (y0: number, y1: number) => strong.some((slot) => y1 >= slot.y && y0 <= slot.y + slot.size);
  // 2. Unboxed line-art logos split into pieces: group pieces that fit inside one slot.
  const loose = blobs
    .filter((b) => b.x0 >= column - 2 && b.x1 <= column + size + 2 && !taken(b.y0, b.y1))
    .sort((a, b) => a.y0 - b.y0);
  const groups: { x0: number; y0: number; x1: number; y1: number; n: number }[] = [];
  for (const b of loose) {
    const last = groups.at(-1);
    if (last && Math.max(last.y1, b.y1) - last.y0 < size + 4) {
      last.x0 = Math.min(last.x0, b.x0);
      last.x1 = Math.max(last.x1, b.x1);
      last.y1 = Math.max(last.y1, b.y1);
      last.n += b.n;
    } else groups.push({ ...b });
  }
  const lineArt = groups
    .filter((g) => {
      const gw = g.x1 - g.x0 + 1, gh = g.y1 - g.y0 + 1;
      // Narrow role-timeline dots and thin glyphs such as the back arrow are not logos.
      return gw >= size * 0.3 && gh >= size * 0.3 && Math.max(gw, gh) >= size * 0.5 && g.n / (gw * gh) >= 0.18;
    })
    .map((g) => slotFor((g.y0 + g.y1) / 2 - size / 2));
  return [...strong, ...lineArt]
    .sort((a, b) => a.y - b.y)
    .map((slot) => ({ ...slot, placeholder: isPlaceholder(image, slot.x, slot.y, size) }));
}

function isPlaceholder(image: Raster, x: number, y: number, size: number): boolean {
  let match = 0, total = 0;
  for (let j = y; j < Math.min(image.height, y + size); j += 1) {
    for (let i = x; i < Math.min(image.width, x + size); i += 1) {
      const k = (j * image.width + i) * 4;
      total += 1;
      if (
        PLACEHOLDER_PALETTE.some(
          (c) => Math.hypot(image.data[k]! - c[0], image.data[k + 1]! - c[1], image.data[k + 2]! - c[2]) < 22,
        )
      ) match += 1;
    }
  }
  return total > 0 && match / total > 0.9;
}

export function cropSlot(image: Raster, slot: ScreenshotSlot): Raster {
  const data = new Uint8Array(slot.size * slot.size * 4);
  for (let j = 0; j < slot.size; j += 1) {
    const from = ((slot.y + j) * image.width + slot.x) * 4;
    data.set(image.data.subarray(from, from + slot.size * 4), j * slot.size * 4);
  }
  return { width: slot.size, height: slot.size, data, format: "png" };
}

