// Logo engine: decodes untrusted images, picks the best candidate per company and
// renders optically normalised 256px tiles. Bundled into dist/logos/engine.cjs and
// run in a worker with network access disabled.
import { isMainThread, parentPort, workerData } from "node:worker_threads";
import { decode as decodePngFile, encode as encodePngFile } from "fast-png";
import jpeg from "jpeg-js";
import { initWasm, Resvg } from "@resvg/resvg-wasm";
import type {
  LogoCandidateInput,
  LogoChoice,
  LogoConfidence,
  LogoEngineRequest,
  LogoEngineResponse,
  LogoEngineResult,
  LogoSourceKind,
  LogoTreatment,
} from "./types.js";

export const TILE = 256;
const WORK = 512;
const MAX_PIXELS = 16_000_000;

export interface Raster {
  readonly width: number;
  readonly height: number;
  /** Straight (non-premultiplied) RGBA. */
  readonly data: Uint8Array;
  readonly format: LogoChoice["format"];
}

/* ---------------- decoding ---------------- */

let resvgReady: Promise<void> | undefined;
export function initVector(wasm: Uint8Array): Promise<void> {
  resvgReady ??= initWasm(wasm);
  return resvgReady;
}

export function decodeImage(bytes: Uint8Array, tint?: string): Raster | undefined {
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
    const head = new TextDecoder().decode(bytes.subarray(0, 1024));
    if (/<svg[\s>]/i.test(head) || /^\s*<\?xml/i.test(head)) return decodeSvg(bytes, tint);
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

function decodeSvg(bytes: Uint8Array, tint?: string): Raster {
  let svg = new TextDecoder().decode(bytes);
  if (tint && /^#[0-9a-f]{6}$/i.test(tint)) svg = svg.replace(/<svg\b/i, `<svg fill="${tint}"`);
  // resvg never fetches external resources or runs scripts; fonts are not loaded.
  const rendered = new Resvg(svg, {
    fitTo: { mode: "width", value: WORK },
    background: "rgba(0,0,0,0)",
    font: { loadSystemFonts: false },
  }).render();
  const data = new Uint8Array(rendered.pixels);
  unpremultiply(data);
  return { width: rendered.width, height: rendered.height, data, format: "svg" };
}

function unpremultiply(data: Uint8Array): void {
  for (let i = 0; i < data.length; i += 4) {
    const a = data[i + 3]!;
    if (a === 0 || a === 255) continue;
    data[i] = Math.min(255, Math.round((data[i]! * 255) / a));
    data[i + 1] = Math.min(255, Math.round((data[i + 1]! * 255) / a));
    data[i + 2] = Math.min(255, Math.round((data[i + 2]! * 255) / a));
  }
}

/* ---------------- analysis ---------------- */

export interface Analysis {
  /** Solid page/tile colour detected around the edge, if any. */
  readonly background?: readonly [number, number, number];
  readonly isTile: boolean;
  readonly isWhiteBackground: boolean;
  readonly box: { x0: number; y0: number; w: number; h: number };
  readonly centroid: { x: number; y: number };
  /** Share of the bounding box covered by ink. */
  readonly coverage: number;
  readonly meanLuminance: number;
  readonly monochrome: boolean;
  readonly accent?: readonly [number, number, number];
}

export type Rejection = "blank" | "flat" | "unreadable" | "placeholder";

export function analyze(image: Raster): Analysis | Rejection {
  const { width: w, height: h, data } = image;
  const border: number[] = [];
  for (let x = 0; x < w; x += 1) border.push((x) * 4, ((h - 1) * w + x) * 4);
  for (let y = 0; y < h; y += 1) border.push(y * w * 4, (y * w + w - 1) * 4);
  const opaque = border.filter((i) => data[i + 3]! > 200);
  let background: [number, number, number] | undefined;
  if (opaque.length / border.length > 0.9) {
    const avg = [0, 1, 2].map(
      (k) => opaque.reduce((sum, i) => sum + data[i + k]!, 0) / opaque.length,
    ) as [number, number, number];
    const spread =
      opaque.reduce(
        (sum, i) => sum + Math.hypot(data[i]! - avg[0], data[i + 1]! - avg[1], data[i + 2]! - avg[2]),
        0,
      ) / opaque.length;
    if (spread < 28) background = avg;
  }
  const isInk = (i: number) =>
    data[i + 3]! > 24 &&
    (!background ||
      Math.hypot(data[i]! - background[0], data[i + 1]! - background[1], data[i + 2]! - background[2]) > 40);

  let x0 = w, y0 = h, x1 = -1, y1 = -1, ink = 0, sx = 0, sy = 0, luminance = 0;
  let saturated = 0;
  const satSum = [0, 0, 0];
  const histogram = new Map<number, number>();
  for (let y = 0; y < h; y += 1) {
    for (let x = 0; x < w; x += 1) {
      const i = (y * w + x) * 4;
      if (!isInk(i)) continue;
      ink += 1;
      sx += x;
      sy += y;
      if (x < x0) x0 = x;
      if (x > x1) x1 = x;
      if (y < y0) y0 = y;
      if (y > y1) y1 = y;
      const r = data[i]!, g = data[i + 1]!, b = data[i + 2]!;
      luminance += 0.2126 * r + 0.7152 * g + 0.0722 * b;
      if (Math.max(r, g, b) - Math.min(r, g, b) > 60) {
        saturated += 1;
        satSum[0] += r;
        satSum[1] += g;
        satSum[2] += b;
      }
      const key = (r >> 5) * 64 + (g >> 5) * 8 + (b >> 5);
      histogram.set(key, (histogram.get(key) ?? 0) + 1);
    }
  }
  if (!ink || ink < w * h * 0.004) return "blank";
  const boxArea = (x1 - x0 + 1) * (y1 - y0 + 1);
  const dominant = Math.max(...histogram.values());
  // A single flat colour filling its box, on nothing, has no mark in it
  // (e.g. a black placeholder square). Inside a brand tile the same shape is a real mark.
  if (!background && dominant / ink > 0.985 && ink / boxArea > 0.95) return "flat";

  const isWhiteBackground = Boolean(background && background.every((v) => v > 236));
  const isTile = Boolean(background && !isWhiteBackground);
  const accent =
    saturated > ink * 0.05
      ? (satSum.map((v) => Math.round(v / saturated)) as [number, number, number])
      : isTile
        ? (background!.map(Math.round) as [number, number, number])
        : undefined;
  return {
    background,
    isTile,
    isWhiteBackground,
    box: { x0, y0, w: x1 - x0 + 1, h: y1 - y0 + 1 },
    centroid: { x: sx / ink, y: sy / ink },
    coverage: ink / boxArea,
    meanLuminance: luminance / ink,
    monochrome: saturated < ink * 0.05,
    accent,
  };
}

/* ---------------- rendering ---------------- */

function sample(image: Raster, fx: number, fy: number, out: number[]): void {
  const { width: w, height: h, data } = image;
  const x = Math.min(w - 1, Math.max(0, fx));
  const y = Math.min(h - 1, Math.max(0, fy));
  const xa = Math.floor(x), ya = Math.floor(y);
  const xb = Math.min(w - 1, xa + 1), yb = Math.min(h - 1, ya + 1);
  const tx = x - xa, ty = y - ya;
  out[0] = out[1] = out[2] = out[3] = 0;
  const taps: [number, number, number][] = [
    [xa, ya, (1 - tx) * (1 - ty)],
    [xb, ya, tx * (1 - ty)],
    [xa, yb, (1 - tx) * ty],
    [xb, yb, tx * ty],
  ];
  for (const [px, py, weight] of taps) {
    const i = (py * w + px) * 4;
    const a = (data[i + 3]! / 255) * weight;
    out[0] += data[i]! * a;
    out[1] += data[i + 1]! * a;
    out[2] += data[i + 2]! * a;
    out[3] += a;
  }
}

/** Places the box region of `image` scaled by `scale` with its top-left at (ox, oy). */
function place(
  image: Raster,
  box: Analysis["box"],
  scale: number,
  ox: number,
  oy: number,
  size: number,
): Uint8Array {
  const out = new Uint8Array(size * size * 4);
  const ss = 3;
  const tap = [0, 0, 0, 0];
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      let r = 0, g = 0, b = 0, a = 0;
      for (let j = 0; j < ss; j += 1) {
        for (let i = 0; i < ss; i += 1) {
          const u = box.x0 + (x + (i + 0.5) / ss - ox) / scale;
          const v = box.y0 + (y + (j + 0.5) / ss - oy) / scale;
          if (u < box.x0 - 0.5 || v < box.y0 - 0.5 || u > box.x0 + box.w - 0.5 || v > box.y0 + box.h - 0.5) continue;
          sample(image, u, v, tap);
          r += tap[0]!;
          g += tap[1]!;
          b += tap[2]!;
          a += tap[3]!;
        }
      }
      const k = (y * size + x) * 4;
      if (a > 0) {
        out[k] = Math.round(r / a);
        out[k + 1] = Math.round(g / a);
        out[k + 2] = Math.round(b / a);
      }
      out[k + 3] = Math.round((a / (ss * ss)) * 255);
    }
  }
  return out;
}

function stripBackground(image: Raster, bg: readonly number[]): Raster {
  const data = new Uint8Array(image.data);
  for (let i = 0; i < data.length; i += 4) {
    const distance = Math.hypot(data[i]! - bg[0]!, data[i + 1]! - bg[1]!, data[i + 2]! - bg[2]!);
    data[i + 3] = Math.min(data[i + 3]!, Math.round(Math.min(1, distance / 60) * 255));
  }
  return { ...image, data };
}

export interface Normalized {
  readonly rgba: Uint8Array;
  readonly treatment: LogoTreatment;
  /** True when the artwork is a dark single-colour mark on transparency. */
  readonly darkInk: boolean;
  readonly lightInk: boolean;
}

export function normalize(image: Raster, analysis: Analysis, size = TILE): Normalized {
  const { box, coverage } = analysis;
  if (analysis.isTile) {
    // A brand-coloured square: keep it full-bleed with its own designed padding.
    const side = Math.min(image.width, image.height);
    const square = { x0: (image.width - side) / 2, y0: (image.height - side) / 2, w: side, h: side };
    return { rgba: place(image, square, size / side, 0, 0, size), treatment: "tile", darkInk: false, lightInk: false };
  }
  const source = analysis.isWhiteBackground ? stripBackground(image, analysis.background!) : image;
  const aspect = box.w / box.h;
  const darkInk = analysis.monochrome && analysis.meanLuminance < 70;
  const lightInk = analysis.monochrome && analysis.meanLuminance > 200;
  if (aspect > 0.85 && aspect < 1.18 && coverage > 0.72) {
    // A filled circle or rounded square is already a finished badge: let it fill the tile.
    const scale = (size * 0.98) / Math.max(box.w, box.h);
    return {
      rgba: place(source, box, scale, (size - box.w * scale) / 2, (size - box.h * scale) / 2, size),
      treatment: "badge",
      darkInk,
      lightInk,
    };
  }
  // Optical sizing: equalise perceived area rather than bounding boxes, because
  // dense shapes read larger than sparse ones of the same size.
  const target = 0.6 * size;
  let scale = target / Math.sqrt(box.w * box.h * Math.sqrt(coverage));
  const wide = aspect > 1.6;
  scale = Math.min(scale, ((wide ? 0.84 : 0.76) * size) / box.w, (0.76 * size) / box.h);
  // Centre on a blend of the box centre and the ink centroid (visual centre).
  const cx = 0.7 * (box.x0 + box.w / 2) + 0.3 * analysis.centroid.x;
  const cy = 0.7 * (box.y0 + box.h / 2) + 0.3 * analysis.centroid.y;
  return {
    rgba: place(source, box, scale, size / 2 - (cx - box.x0) * scale, size / 2 - (cy - box.y0) * scale, size),
    treatment: wide ? "wordmark" : "mark",
    darkInk,
    lightInk,
  };
}

/** Composites transparent artwork over an opaque colour. */
export function flatten(rgba: Uint8Array, color: readonly [number, number, number]): Uint8Array {
  const out = new Uint8Array(rgba.length);
  for (let i = 0; i < rgba.length; i += 4) {
    const a = rgba[i + 3]! / 255;
    out[i] = Math.round(rgba[i]! * a + color[0] * (1 - a));
    out[i + 1] = Math.round(rgba[i + 1]! * a + color[1] * (1 - a));
    out[i + 2] = Math.round(rgba[i + 2]! * a + color[2] * (1 - a));
    out[i + 3] = 255;
  }
  return out;
}

function invertInk(rgba: Uint8Array): Uint8Array {
  const out = new Uint8Array(rgba);
  for (let i = 0; i < out.length; i += 4) {
    out[i] = 255 - out[i]!;
    out[i + 1] = 255 - out[i + 1]!;
    out[i + 2] = 255 - out[i + 2]!;
  }
  return out;
}

export function encodePng(rgba: Uint8Array, width: number, height = width): Uint8Array {
  return encodePngFile({ width, height, data: rgba, channels: 4 });
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

/* ---------------- ranking ---------------- */

interface Scored {
  readonly candidate: LogoCandidateInput;
  readonly image: Raster;
  readonly analysis: Analysis;
  readonly effectivePx: number;
  readonly score: number;
}

export function score(candidate: LogoCandidateInput, image: Raster, analysis: Analysis): Scored {
  const vector = image.format === "svg";
  const effectivePx = vector
    ? 1024
    : Math.min(Math.min(image.width, image.height), Math.max(analysis.box.w, analysis.box.h));
  let value = Math.min(effectivePx, 512);
  if (vector) value += 200;
  if (Math.abs(image.width / image.height - 1) > 0.4) value -= 150; // banners and wordmark lockups
  switch (candidate.source) {
    case "file":
      value += 2000; // the person's own choice always wins
      break;
    case "simple-icons":
      value = 220; // official vector, but single-colour: beats small favicons, loses to good colour art
      break;
    case "linkedin-screenshot":
      value += 40; // the company's own chosen avatar
      break;
    case "favicon-service":
      // Often an upscale of the same favicon: worth more than a tiny icon, never more than real 128px art.
      value = Math.min(effectivePx, 128) * 0.75;
      break;
    default:
      break;
  }
  // Wide wordmarks are unreadable in a 30px square; any square mark should beat them.
  const inkAspect = analysis.box.w / analysis.box.h;
  if (candidate.source !== "file") value -= inkAspect > 2.2 ? 250 : inkAspect > 1.6 ? 60 : 0;
  return { candidate, image, analysis, effectivePx, score: value };
}

function confidenceFor(effectivePx: number): LogoConfidence {
  return effectivePx >= 128 ? "high" : effectivePx >= 72 ? "medium" : "low";
}

const hex = (rgb: readonly number[]) => `#${rgb.map((v) => v.toString(16).padStart(2, "0")).join("")}`;

/* ---------------- contact sheet ---------------- */

function roundedMask(rgba: Uint8Array, size: number, radius: number): Uint8Array {
  const out = new Uint8Array(rgba);
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const dx = Math.max(radius - x - 0.5, 0, x + 0.5 - (size - radius));
      const dy = Math.max(radius - y - 0.5, 0, y + 0.5 - (size - radius));
      const d = Math.hypot(dx, dy) - radius;
      const coverage = Math.min(1, Math.max(0, 0.5 - d));
      out[(y * size + x) * 4 + 3] = Math.round(out[(y * size + x) * 4 + 3]! * coverage);
    }
  }
  return out;
}

function downsample(rgba: Uint8Array, from: number, to: number): Uint8Array {
  const image: Raster = { width: from, height: from, data: rgba, format: "png" };
  return place(image, { x0: 0, y0: 0, w: from, h: from }, to / from, 0, 0, to);
}

function blit(canvas: Uint8Array, cw: number, art: Uint8Array, size: number, ox: number, oy: number): void {
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const s = (y * size + x) * 4, d = ((oy + y) * cw + ox + x) * 4;
      const a = art[s + 3]! / 255;
      for (let k = 0; k < 3; k += 1) canvas[d + k] = Math.round(art[s + k]! * a + canvas[d + k]! * (1 - a));
    }
  }
}

/** Renders a review sheet: light and dark rails at 30px (x2), then 48px tiles (x2) per company. */
export function contactSheet(tiles: readonly (Uint8Array | undefined)[], dark: readonly (Uint8Array | undefined)[]): Uint8Array {
  const n = Math.max(1, tiles.length);
  const rail = 60, big = 96, gap = 16, pad = 24;
  const width = pad * 2 + Math.max(n * (rail + gap) - gap, 2 * big + gap);
  const height = pad * 2 + (rail + pad) * 2 + n * (big + gap);
  const canvas = new Uint8Array(width * height * 4);
  const fill = (x: number, y: number, w: number, h: number, c: readonly number[]) => {
    for (let j = y; j < y + h; j += 1)
      for (let i = x; i < x + w; i += 1) canvas.set([c[0]!, c[1]!, c[2]!, 255], (j * width + i) * 4);
  };
  fill(0, 0, width, height, [244, 243, 239]);
  fill(0, pad + rail + pad / 2, width, rail + pad, [22, 22, 22]);
  // Companies without artwork show a neutral tile, as the component shows their initial.
  const solid = (c: readonly number[]) => {
    const tile = new Uint8Array(TILE * TILE * 4);
    for (let i = 0; i < tile.length; i += 4) tile.set([c[0]!, c[1]!, c[2]!, 255], i);
    return tile;
  };
  const missingLight = solid([224, 222, 216]);
  const missingDark = solid([48, 48, 48]);
  tiles.forEach((tile, index) => {
    const lightArt = tile ?? missingLight;
    const darkArt = dark[index] ?? tile ?? missingDark;
    const light = roundedMask(downsample(lightArt, TILE, rail), rail, 16);
    const night = roundedMask(downsample(darkArt, TILE, rail), rail, 16);
    blit(canvas, width, light, rail, pad + index * (rail + gap), pad);
    blit(canvas, width, night, rail, pad + index * (rail + gap), pad + rail + pad);
    const y = pad + (rail + pad) * 2 + index * (big + gap);
    fill(pad + big + gap, y, big, big, [22, 22, 22]);
    blit(canvas, width, roundedMask(downsample(lightArt, TILE, big), big, 24), big, pad, y);
    blit(canvas, width, roundedMask(downsample(darkArt, TILE, big), big, 24), big, pad + big + gap, y);
  });
  return encodePng(canvas, width, height);
}

/* ---------------- entry point ---------------- */

const WHITE = [255, 255, 255] as const;
const INK = [17, 17, 17] as const;

export async function runEngine(request: LogoEngineRequest): Promise<LogoEngineResponse> {
  await initVector(request.resvgWasm);
  let slots: ScreenshotSlot[] = [];
  let screenshot: Raster | undefined;
  if (request.screenshot) {
    screenshot = decodeImage(request.screenshot);
    if (screenshot) slots = findScreenshotSlots(screenshot);
  }
  const results: LogoEngineResult[] = [];
  const lightTiles: (Uint8Array | undefined)[] = [];
  const darkTiles: (Uint8Array | undefined)[] = [];
  for (const item of request.items) {
    const rejected: { source: LogoSourceKind; reason: string }[] = [];
    const scored: Scored[] = [];
    const consider = (candidate: LogoCandidateInput, image: Raster | undefined) => {
      if (!image || image.width < 16 || image.height < 16) {
        rejected.push({ source: candidate.source, reason: "unreadable" });
        return;
      }
      const analysis = analyze(image);
      if (typeof analysis === "string") {
        rejected.push({ source: candidate.source, reason: analysis });
        return;
      }
      scored.push(score(candidate, image, analysis));
    };
    for (const candidate of item.candidates) consider(candidate, decodeImage(candidate.bytes, candidate.tint));
    const slot = item.screenshotSlot === undefined ? undefined : slots[item.screenshotSlot];
    if (slot && screenshot) {
      const candidate: LogoCandidateInput = { source: "linkedin-screenshot", bytes: new Uint8Array() };
      if (slot.placeholder) rejected.push({ source: "linkedin-screenshot", reason: "placeholder" });
      else consider(candidate, cropSlot(screenshot, slot));
    }
    scored.sort((a, b) => b.score - a.score);
    const best = scored[0];
    if (!best) {
      results.push({ key: item.key, rejected });
      lightTiles.push(undefined);
      darkTiles.push(undefined);
      continue;
    }
    const normalized = normalize(best.image, best.analysis);
    let png: Uint8Array;
    let pngDark: Uint8Array | undefined;
    let light: Uint8Array;
    let night: Uint8Array;
    if (normalized.treatment === "tile" || request.surface === "white") {
      // Default: bake the artwork onto its own opaque tile, like an app icon, so it
      // reads the same on any host theme. Light-only ink sits on a dark tile instead.
      const base = normalized.treatment === "tile" ? WHITE : normalized.lightInk ? INK : WHITE;
      light = night = flatten(normalized.rgba, base);
      png = encodePng(light, TILE);
    } else {
      light = flatten(normalized.rgba, WHITE);
      night = normalized.darkInk ? flatten(invertInk(normalized.rgba), INK) : flatten(normalized.rgba, INK);
      png = encodePng(normalized.rgba, TILE);
      if (normalized.darkInk) pngDark = encodePng(invertInk(normalized.rgba), TILE);
    }
    lightTiles.push(light);
    darkTiles.push(night);
    results.push({
      key: item.key,
      choice: {
        source: best.candidate.source,
        url: best.candidate.url,
        format: best.image.format,
        effectivePx: best.effectivePx,
        treatment: normalized.treatment,
        confidence: best.candidate.source === "file" ? "high" : confidenceFor(best.effectivePx),
        ...(best.analysis.accent ? { accent: hex(best.analysis.accent) } : {}),
      },
      png,
      ...(pngDark ? { pngDark } : {}),
      rejected,
    });
  }
  return {
    results,
    sheet: contactSheet(lightTiles, darkTiles),
    ...(request.screenshot
      ? { screenshot: { slots: slots.length, placeholders: slots.filter((s) => s.placeholder).length } }
      : {}),
  };
}

if (!isMainThread && parentPort && (workerData as { logoEngine?: boolean } | undefined)?.logoEngine) {
  const port = parentPort;
  port.once("message", (request: LogoEngineRequest) => {
    runEngine(request).then(
      (response) => port.postMessage({ response }),
      () => port.postMessage({ error: "engine" }),
    );
  });
}
