// Logo engine: decodes untrusted images, picks the best candidate per company and
// renders optically normalised 256px tiles. Bundled into dist/logos/engine.cjs and
// run in a worker with network access disabled.
import { isMainThread, parentPort, workerData } from "node:worker_threads";
import { encode as encodePngFile } from "fast-png";
import { initWasm, Resvg } from "@resvg/resvg-wasm";
import type {
  LogoCandidateInput,
  LogoConfidence,
  LogoEngineRequest,
  LogoEngineResponse,
  LogoEngineResult,
  LogoSourceKind,
  LogoTreatment,
} from "./types.js";
import { cropSlot, decodeRaster, findScreenshotSlots, type Raster, type ScreenshotSlot } from "./raster.js";

export { cropSlot, findScreenshotSlots, type Raster, type ScreenshotSlot } from "./raster.js";

export const TILE = 256;
const WORK = 512;

/* ---------------- decoding ---------------- */

let resvgReady: Promise<void> | undefined;
export function initVector(wasm: Uint8Array): Promise<void> {
  resvgReady ??= initWasm(wasm);
  return resvgReady;
}

export function decodeImage(bytes: Uint8Array, tint?: string): Raster | undefined {
  const raster = decodeRaster(bytes);
  if (raster) return raster;
  try {
    const head = new TextDecoder().decode(bytes.subarray(0, 1024));
    if (/<svg[\s>]/i.test(head) || /^\s*<\?xml/i.test(head)) return decodeSvg(bytes, tint);
  } catch {
    // Unreadable images are rejected by the caller.
  }
  return undefined;
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
