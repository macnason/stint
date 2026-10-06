import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { encode as encodePngFile } from "fast-png";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { runCli, type CliIo } from "../src/cli.js";
import {
  analyze,
  decodeImage,
  encodePng,
  findScreenshotSlots,
  initVector,
  normalize,
  score,
  type Raster,
} from "../src/logos/engine.js";
import { LogoDiscovery, fetchBytes, isValidDomain, linkCandidates, matchSimpleIcon, type Fetcher } from "../src/logos/discover.js";

const require = createRequire(import.meta.url);
const directories: string[] = [];
afterEach(() => directories.splice(0).forEach((p) => rmSync(p, { recursive: true, force: true })));
beforeAll(async () => {
  await initVector(readFileSync(require.resolve("@resvg/resvg-wasm/index_bg.wasm")));
});

type Rgb = readonly [number, number, number];

function canvas(width: number, height = width, fill: readonly number[] = [0, 0, 0, 0]): Raster {
  const data = new Uint8Array(width * height * 4);
  for (let i = 0; i < data.length; i += 4) data.set(fill, i);
  return { width, height, data, format: "png" };
}

function rect(image: Raster, x: number, y: number, w: number, h: number, color: Rgb, alpha = 255) {
  for (let j = y; j < y + h; j += 1)
    for (let i = x; i < x + w; i += 1) image.data.set([color[0], color[1], color[2], alpha], (j * image.width + i) * 4);
}

function disc(image: Raster, cx: number, cy: number, r: number, color: Rgb) {
  for (let j = Math.floor(cy - r); j <= cy + r; j += 1)
    for (let i = Math.floor(cx - r); i <= cx + r; i += 1)
      if ((i - cx) ** 2 + (j - cy) ** 2 <= r * r) image.data.set([color[0], color[1], color[2], 255], (j * image.width + i) * 4);
}

const png = (image: Raster) => encodePng(image.data, image.width, image.height);

/** Bounding box of opaque pixels in a normalised tile. */
function inkBox(rgba: Uint8Array, size = 256) {
  let x0 = size, y0 = size, x1 = -1, y1 = -1, ink = 0;
  for (let y = 0; y < size; y += 1)
    for (let x = 0; x < size; x += 1)
      if (rgba[(y * size + x) * 4 + 3]! > 128) {
        ink += 1;
        x0 = Math.min(x0, x);
        y0 = Math.min(y0, y);
        x1 = Math.max(x1, x);
        y1 = Math.max(y1, y);
      }
  return { w: x1 - x0 + 1, h: y1 - y0 + 1, cx: (x0 + x1) / 2, cy: (y0 + y1) / 2, ink };
}

describe("logo decoding", () => {
  it("expands 1-bit greyscale PNGs instead of reading them as solid colour", () => {
    // 16x16, 1-bit: left half black, right half white.
    const rows = new Uint8Array(16 * 2);
    for (let y = 0; y < 16; y += 1) rows[y * 2 + 1] = 0xff;
    const file = encodePngFile({ width: 16, height: 16, data: rows, depth: 1, channels: 1 });
    const image = decodeImage(file)!;
    expect(image.width).toBe(16);
    expect(image.data[0]).toBe(0);
    expect(image.data[(8 + 0) * 4]).toBe(255);
  });

  it("reads PNG frames inside ICO files", () => {
    const frame = png(canvas(32, 32, [10, 20, 30, 255]));
    const header = new Uint8Array(22);
    const view = new DataView(header.buffer);
    view.setUint16(2, 1, true);
    view.setUint16(4, 1, true);
    header[6] = 32;
    header[7] = 32;
    view.setUint32(14, frame.length, true);
    view.setUint32(18, 22, true);
    const image = decodeImage(new Uint8Array([...header, ...frame]))!;
    expect([image.format, image.width, image.data[0]]).toEqual(["ico", 32, 10]);
  });

  it("renders SVG without external resources and applies a brand tint", () => {
    const svg = new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><path d="M0 0h10v10H0z"/></svg>');
    const image = decodeImage(svg, "#ff0000")!;
    expect(image.format).toBe("svg");
    const mid = (image.height / 2) * image.width * 4 + (image.width / 2) * 4;
    expect([image.data[mid], image.data[mid + 1]]).toEqual([255, 0]);
  });

  it("rejects unknown bytes", () => {
    expect(decodeImage(new TextEncoder().encode("<html>not an image</html>"))).toBeUndefined();
  });
});

describe("logo analysis and normalisation", () => {
  it("rejects blank images and flat placeholder squares", () => {
    expect(analyze(canvas(64))).toBe("blank");
    const square = canvas(64);
    // On transparency, a lone flat square carries no mark.
    rect(square, 8, 8, 48, 48, [0, 0, 0]);
    expect(analyze(square)).toBe("flat");
  });

  it("keeps brand-coloured squares full-bleed", () => {
    const tile = canvas(128, 128, [99, 91, 255, 255]);
    rect(tile, 40, 40, 48, 30, [255, 255, 255]);
    const analysis = analyze(tile);
    if (typeof analysis === "string") throw new Error(analysis);
    const result = normalize(tile, analysis);
    expect(result.treatment).toBe("tile");
    expect(Array.from(result.rgba.subarray(0, 4))).toEqual([99, 91, 255, 255]);
  });

  it("lets filled circles fill the tile as badges", () => {
    const icon = canvas(128);
    disc(icon, 64, 64, 40, [24, 119, 242]);
    rect(icon, 58, 40, 10, 50, [255, 255, 255]);
    const analysis = analyze(icon);
    if (typeof analysis === "string") throw new Error(analysis);
    const result = normalize(icon, analysis);
    expect(result.treatment).toBe("badge");
    expect(inkBox(result.rgba).w).toBeGreaterThan(240);
  });

  it("removes white page backgrounds and sizes marks by perceived area", () => {
    // A dense block and a sparse outline with the same bounding box.
    const dense = canvas(200, 200, [255, 255, 255, 255]);
    rect(dense, 40, 60, 120, 80, [20, 20, 20]);
    rect(dense, 90, 90, 20, 20, [255, 255, 255]);
    const sparse = canvas(200);
    rect(sparse, 40, 60, 120, 8, [20, 20, 20]);
    rect(sparse, 40, 132, 120, 8, [20, 20, 20]);
    rect(sparse, 40, 60, 8, 80, [20, 20, 20]);
    rect(sparse, 152, 60, 8, 80, [20, 20, 20]);
    const [a, b] = [dense, sparse].map((image) => {
      const analysis = analyze(image);
      if (typeof analysis === "string") throw new Error(analysis);
      return normalize(image, analysis);
    });
    // The white background is gone, and the corner stays transparent.
    expect(a!.rgba[3]).toBe(0);
    // Sparse shapes are drawn larger so both read with similar weight.
    expect(inkBox(b!.rgba).w).toBeGreaterThan(inkBox(a!.rgba).w);
    // Both are centred.
    for (const r of [a!, b!]) expect(Math.abs(inkBox(r.rgba).cx - 128)).toBeLessThan(6);
  });

  it("marks dark single-colour marks so a dark-mode variant can be made", () => {
    const icon = canvas(100);
    rect(icon, 20, 30, 60, 10, [10, 10, 10]);
    rect(icon, 20, 60, 60, 10, [10, 10, 10]);
    const analysis = analyze(icon);
    if (typeof analysis === "string") throw new Error(analysis);
    expect(normalize(icon, analysis).darkInk).toBe(true);
  });

  it("ranks sources: a person's file first, a favicon service never above real 128px art", () => {
    const icon = canvas(256);
    disc(icon, 128, 128, 60, [200, 40, 40]);
    rect(icon, 100, 100, 20, 20, [255, 255, 255]);
    const analysis = analyze(icon);
    if (typeof analysis === "string") throw new Error(analysis);
    const of = (source: Parameters<typeof score>[0]["source"]) => score({ source, bytes: new Uint8Array() }, icon, analysis).score;
    expect(of("file")).toBeGreaterThan(of("site-icon"));
    expect(of("favicon-service")).toBeLessThanOrEqual(96);
    expect(of("simple-icons")).toBe(220);
  });

  it("ranks a square mark above a wide wordmark from any source", () => {
    const wordmark = canvas(300, 100);
    rect(wordmark, 10, 35, 280, 30, [127, 84, 179]);
    rect(wordmark, 60, 40, 20, 20, [255, 255, 255]);
    const square = canvas(150);
    disc(square, 75, 75, 60, [127, 84, 179]);
    rect(square, 60, 60, 30, 30, [255, 255, 255]);
    const scoreOf = (image: Raster, source: Parameters<typeof score>[0]["source"]) => {
      const analysis = analyze(image);
      if (typeof analysis === "string") throw new Error(analysis);
      return score({ source, bytes: new Uint8Array() }, image, analysis).score;
    };
    expect(scoreOf(square, "site-icon")).toBeGreaterThan(scoreOf(wordmark, "simple-icons"));
  });
});

describe("LinkedIn screenshot slots", () => {
  function screenshot(): Raster {
    const page = canvas(1000, 900, [244, 242, 238, 255]);
    rect(page, 30, 0, 940, 900, [255, 255, 255]);
    // Back arrow above the heading: thin, small — not a logo.
    rect(page, 60, 30, 36, 3, [40, 40, 40]);
    // Boxed logo, LinkedIn placeholder, line-art logo in two pieces, near-white wordmark box.
    rect(page, 60, 100, 60, 60, [24, 119, 242]);
    rect(page, 60, 260, 60, 60, [224, 224, 216]);
    rect(page, 90, 260, 20, 40, [160, 176, 192]);
    disc(page, 80, 440, 12, [240, 106, 106]);
    disc(page, 100, 440, 12, [240, 106, 106]);
    rect(page, 60, 560, 60, 30, [247, 247, 247]);
    rect(page, 70, 570, 40, 8, [120, 120, 120]);
    // Grouped-role timeline: dots joined by a thin line.
    disc(page, 90, 700, 5, [180, 180, 180]);
    rect(page, 89, 700, 2, 120, [210, 210, 210]);
    disc(page, 90, 820, 5, [180, 180, 180]);
    return page;
  }

  it("finds one slot per employer, top to bottom, and recognises placeholders", () => {
    const slots = findScreenshotSlots(screenshot());
    expect(slots.map((s) => [s.x, s.size, s.placeholder])).toEqual([
      [60, 60, false],
      [60, 60, true],
      [60, 60, false],
      [60, 60, false],
    ]);
    expect(slots.map((s) => s.y)).toEqual([...slots.map((s) => s.y)].sort((a, b) => a - b));
  });
});

describe("logo discovery", () => {
  const pngBytes = png((() => {
    const icon = canvas(180);
    disc(icon, 90, 90, 70, [99, 91, 255]);
    rect(icon, 70, 70, 40, 40, [255, 255, 255]);
    return icon;
  })());

  function site(routes: Record<string, string | Uint8Array | { redirect: string }>): Fetcher & { calls: string[] } {
    const calls: string[] = [];
    const fetcher = (async (url: string) => {
      calls.push(url);
      const route = routes[url];
      if (route === undefined) return new Response(null, { status: 404 });
      if (typeof route === "object" && "redirect" in route)
        return new Response(null, { status: 301, headers: { location: route.redirect } });
      return new Response(route as BodyInit);
    }) as Fetcher & { calls: string[] };
    fetcher.calls = calls;
    return fetcher;
  }

  it("accepts only public hostnames", () => {
    expect(isValidDomain("stripe.com")).toBe(true);
    for (const bad of ["localhost", "10.0.0.1", "printer.local", "-x.com", "a"]) expect(isValidDomain(bad)).toBe(false);
  });

  it("collects icons, mask icons with their colour and manifest icons; ignores insecure links", () => {
    const links = linkCandidates(
      `<link rel="apple-touch-icon" href="/apple.png"><link rel="mask-icon" href="/pin.svg" color="#0055FF">
       <link rel="icon" href="http://insecure.example.com/x.png"><link rel="manifest" href="/site.webmanifest">`,
      "https://brand.com/",
    );
    expect(links).toEqual([
      { url: "https://brand.com/apple.png", source: "apple-touch-icon" },
      { url: "https://brand.com/pin.svg", source: "site-icon", tint: "#0055FF" },
      { url: "https://brand.com/site.webmanifest", source: "manifest", manifest: true },
    ]);
  });

  it("does not follow redirects to non-https or private hosts, and enforces byte limits", async () => {
    const fetcher = site({
      "https://brand.com/a": { redirect: "http://brand.com/a" },
      "https://brand.com/b": { redirect: "https://localhost/b" },
      "https://brand.com/big": new Uint8Array(2000),
    });
    expect(await fetchBytes(fetcher, "https://brand.com/a")).toBeUndefined();
    expect(await fetchBytes(fetcher, "https://brand.com/b")).toBeUndefined();
    expect(await fetchBytes(fetcher, "https://brand.com/big", 1000)).toBeUndefined();
    expect(fetcher.calls).not.toContain("http://brand.com/a");
  });

  it("matches Simple Icons by the brand's domain, never by name alone", () => {
    const icons = [
      { title: "Spectrum", slug: "spectrum", hex: "000000", source: "https://www.spectrum.com/" },
      { title: "Stripe", slug: "stripe", hex: "635BFF", source: "https://stripe.com/newsroom/brand-assets" },
    ];
    expect(matchSimpleIcon(icons, { company: "Spectrum", domain: "spectrum.chat" })).toBeUndefined();
    expect(matchSimpleIcon(icons, { company: "Stripe", domain: "stripe.com" })?.slug).toBe("stripe");
  });

  it("does not use icons from a domain that redirects elsewhere or is parked", async () => {
    const discovery = new LogoDiscovery(
      site({
        "https://moved.chat/": { redirect: "https://github.com/" },
        "https://github.com/": '<link rel="icon" href="/favicon.svg">',
        "https://parked.com/": '<script>window.onload=function(){window.location.href="/lander"}</script>',
      }),
    );
    const moved = await discovery.discover({ company: "Moved", domain: "moved.chat" });
    expect([moved.siteStatus, moved.redirectedTo, moved.candidates]).toEqual(["redirected", "github.com", []]);
    const parked = await discovery.discover({ company: "Parked", domain: "parked.com" });
    expect([parked.siteStatus, parked.candidates]).toEqual(["parked", []]);
  });

  it("finds a site's own icons and adds the GitHub avatar when known", async () => {
    const discovery = new LogoDiscovery(
      site({
        "https://brand.com/": '<link rel="apple-touch-icon" href="/apple.png">',
        "https://brand.com/apple.png": pngBytes,
        "https://github.com/brand.png?size=460": pngBytes,
      }),
    );
    const result = await discovery.discover({ company: "Brand", domain: "brand.com", github: "brand" });
    expect(result.siteStatus).toBe("ok");
    expect(result.candidates.map((c) => c.source)).toEqual(["apple-touch-icon", "github-avatar"]);
  });
});

describe("stint logos command", () => {
  const io = () => {
    const stdout: string[] = [];
    return { isTTY: false, stdout, writeOut: (s: string) => void stdout.push(s), writeError: () => {} } satisfies CliIo & {
      stdout: string[];
    };
  };

  function project() {
    const root = mkdtempSync(join(tmpdir(), "stint-logos-test-"));
    directories.push(root);
    mkdirSync(join(root, "app"));
    writeFileSync(join(root, "package.json"), JSON.stringify({ dependencies: { next: "16.0.0" } }));
    writeFileSync(
      join(root, "stint.config.json"),
      JSON.stringify({
        schemaVersion: 1,
        entries: [
          { id: "acme-2020-01", company: "Acme", start: "2020-01", end: null, roles: [{ id: "r1", title: "Designer", start: "2020-01" }] },
          { id: "globex-2018-01", company: "Globex", start: "2018-01", end: "2020-01", roles: [{ id: "r2", title: "Designer", start: "2018-01" }] },
        ],
      }),
    );
    return root;
  }

  it("stages a review without writing, then applies logos and a typed module", async () => {
    const root = project();
    const logo = canvas(256);
    disc(logo, 128, 128, 100, [99, 91, 255]);
    rect(logo, 100, 90, 56, 70, [255, 255, 255]);
    writeFileSync(join(root, "acme.png"), png(logo));
    const input = join(root, "logos.json");
    writeFileSync(input, JSON.stringify({ version: 1, companies: [{ company: "Acme", file: join(root, "acme.png") }] }));

    const first = io();
    expect(await runCli(["logos", "--project", root, "--input", input, "--offline", "--json"], first)).toBe(0);
    const review = JSON.parse(first.stdout.join(""));
    expect(review.state).toBe("needs_review");
    expect(existsSync(review.sheet)).toBe(true);
    expect(review.logos.map((l: { company: string; confidence: string }) => [l.company, l.confidence])).toEqual([
      ["Acme", "high"],
      ["Globex", "none"],
    ]);
    expect(existsSync(join(root, "public"))).toBe(false);

    const second = io();
    expect(await runCli(["logos", "--project", root, "--input", input, "--offline", "--apply", "--json"], second)).toBe(0);
    const applied = JSON.parse(second.stdout.join(""));
    expect(applied.state).toBe("complete");
    expect(existsSync(join(root, "public/stint/logos/acme-2020-01.png"))).toBe(true);
    const module = readFileSync(join(root, "app/stint.logos.ts"), "utf8");
    expect(module).toContain('"acme-2020-01"');
    expect(module).toContain('"src": "/stint/logos/acme-2020-01.png"');
    expect(module).not.toContain("globex");
  });

  it("applies exactly the staged review without fetching again", async () => {
    const root = project();
    mkdirSync(join(root, "node_modules"));
    const icon = canvas(180);
    disc(icon, 90, 90, 70, [99, 91, 255]);
    rect(icon, 70, 70, 40, 40, [255, 255, 255]);
    let calls = 0;
    const fetcher: Fetcher = async (url) => {
      calls += 1;
      if (url === "https://acme.com/") return new Response('<link rel="apple-touch-icon" href="/a.png">');
      if (url === "https://acme.com/a.png") return new Response(png(icon));
      return new Response(null, { status: 404 });
    };
    const input = join(root, "logos.json");
    writeFileSync(input, JSON.stringify({ version: 1, companies: [{ company: "Acme", domain: "acme.com" }] }));
    const { logosCommand } = await import("../src/commands/logos.js");
    const { parseOptions } = await import("../src/options.js");
    const review = await logosCommand(parseOptions(["--project", root, "--input", input, "--json"]), { fetcher });
    expect(String(review.payload.sheet)).toContain(join(root, "node_modules", ".cache", "stint"));
    const fetched = calls;
    expect(fetched).toBeGreaterThan(0);
    const applied = await logosCommand(parseOptions(["--project", root, "--input", input, "--apply", "--json"]), { fetcher });
    expect(applied.payload.state).toBe("complete");
    expect(calls).toBe(fetched);
    expect(readFileSync(join(root, "public/stint/logos/acme-2020-01.png")).length).toBeGreaterThan(100);
  });

  it("ignores screenshot crops when the slot count does not match the history", async () => {
    const root = project();
    const shot = canvas(600, 400, [255, 255, 255, 255]);
    rect(shot, 40, 40, 50, 50, [10, 120, 200]);
    writeFileSync(join(root, "shot.png"), png(shot));
    const out = io();
    expect(await runCli(["logos", "--project", root, "--screenshot", join(root, "shot.png"), "--offline", "--json"], out)).toBe(0);
    const review = JSON.parse(out.stdout.join(""));
    expect(review.screenshot.used).toBe(false);
  });

  it("rejects private or malformed domains in the input", async () => {
    const root = project();
    const input = join(root, "logos.json");
    writeFileSync(input, JSON.stringify({ version: 1, companies: [{ company: "Acme", domain: "localhost" }] }));
    const out = io();
    expect(await runCli(["logos", "--project", root, "--input", input, "--offline", "--json"], out)).not.toBe(0);
  });
});
