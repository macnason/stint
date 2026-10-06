// Finds logo candidates for a company on the public web. Network access stays in
// the CLI process; decoding happens in the offline logo engine.
import type { LogoCandidateInput, LogoSourceKind } from "./types.js";

export interface LogoRequest {
  readonly company: string;
  /** The company's own website, resolved by the agent (e.g. "stripe.com"). */
  readonly domain?: string;
  /** GitHub organisation login, when the agent knows it. */
  readonly github?: string;
  /** Simple Icons slug, to override domain matching. */
  readonly simpleIcon?: string;
}

export interface DiscoveryResult {
  readonly candidates: LogoCandidateInput[];
  /** Notes the agent should pass on, e.g. a domain that now belongs to someone else. */
  readonly notes: string[];
  readonly siteStatus: "ok" | "unreachable" | "redirected" | "parked" | "none";
  readonly redirectedTo?: string;
}

export type Fetcher = (url: string, init: RequestInit) => Promise<Response>;

const SIMPLE_ICONS = "https://cdn.jsdelivr.net/npm/simple-icons@16";
const MAX_BYTES = 3_000_000;
const MAX_HTML = 2_000_000;
const TIMEOUT_MS = 10_000;
const UA =
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/154.0 Safari/537.36 stint-cli";
const PARKED = [
  /domain (name )?(is|may be) for sale/i,
  /buy this domain/i,
  /this domain is parked/i,
  /parked (free|domain)/i,
  /(sedo|afternic|dan\.com|hugedomains|undeveloped)\b/i,
  /location\.(href|replace)\s*\(?=?\s*["']\/lander/i, // GoDaddy parking lander
];

export function isValidDomain(value: string): boolean {
  return (
    value.length <= 253 &&
    /^(?!-)[a-z0-9-]{1,63}(?<!-)(\.(?!-)[a-z0-9-]{1,63}(?<!-))+$/i.test(value) &&
    !/^\d+(\.\d+)+$/.test(value) &&
    !/(^|\.)(localhost|local|internal|home|lan)$/i.test(value)
  );
}

function safeUrl(raw: string, base?: string): URL | undefined {
  try {
    const url = new URL(raw.replace(/&amp;/g, "&"), base);
    if (url.protocol !== "https:" || url.username || url.password) return undefined;
    if (!isValidDomain(url.hostname)) return undefined;
    return url;
  } catch {
    return undefined;
  }
}

/** Fetches an https URL with manual redirects, a timeout and a byte limit. */
export async function fetchBytes(
  fetcher: Fetcher,
  raw: string,
  limit = MAX_BYTES,
): Promise<{ bytes: Uint8Array; url: string; type: string } | undefined> {
  let url = safeUrl(raw);
  for (let hop = 0; url && hop < 5; hop += 1) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    try {
      const response = await fetcher(url.href, {
        redirect: "manual",
        signal: controller.signal,
        headers: { "user-agent": UA, accept: "text/html,image/*,application/json;q=0.9,*/*;q=0.5" },
      });
      if (response.status >= 300 && response.status < 400) {
        const next = response.headers.get("location");
        url = next ? safeUrl(next, url.href) : undefined;
        continue;
      }
      if (!response.ok || !response.body) return undefined;
      const declared = Number(response.headers.get("content-length") ?? 0);
      if (declared > limit) return undefined;
      const reader = response.body.getReader();
      const chunks: Uint8Array[] = [];
      let total = 0;
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        total += value.byteLength;
        if (total > limit) {
          await reader.cancel();
          return undefined;
        }
        chunks.push(value);
      }
      const bytes = new Uint8Array(total);
      let offset = 0;
      for (const chunk of chunks) {
        bytes.set(chunk, offset);
        offset += chunk.byteLength;
      }
      return { bytes, url: url.href, type: response.headers.get("content-type") ?? "" };
    } catch {
      return undefined;
    } finally {
      clearTimeout(timer);
    }
  }
  return undefined;
}

interface SimpleIcon {
  readonly title: string;
  readonly slug?: string;
  readonly hex: string;
  readonly source?: string;
  readonly guidelines?: string;
}

const normalizeName = (value: string) => value.toLowerCase().replace(/[^a-z0-9]/g, "");
const slugFor = (icon: SimpleIcon) =>
  icon.slug ??
  icon.title
    .toLowerCase()
    .replace(/\+/g, "plus")
    .replace(/\./g, "dot")
    .replace(/&/g, "and")
    .normalize("NFD")
    .replace(/[^a-z0-9]/g, "");
/** The registrable domain, TLD included ("spectrum.chat" and "spectrum.com" differ). */
const registrable = (host: string) => {
  const labels = host.toLowerCase().replace(/^www\./, "").split(".");
  // Country second-level domains such as flg.com.au or bbc.co.uk keep three labels.
  const keep = labels.length > 2 && /^(com|co|net|org|gov|edu|ac)$/.test(labels.at(-2)!) && labels.at(-1)!.length === 2 ? 3 : 2;
  return labels.slice(-keep).join(".");
};

/** Matches by the brand's own domain, never by name alone: names collide ("Spectrum"). */
export function matchSimpleIcon(icons: readonly SimpleIcon[], request: LogoRequest): SimpleIcon | undefined {
  if (request.simpleIcon) return icons.find((icon) => slugFor(icon) === request.simpleIcon);
  if (!request.domain) return undefined;
  const site = registrable(request.domain);
  const host = (value?: string) => {
    try {
      return value ? registrable(new URL(value).hostname) : "";
    } catch {
      return "";
    }
  };
  const company = normalizeName(request.company);
  return icons
    .filter((icon) => host(icon.source) === site || host(icon.guidelines) === site)
    .find((icon) => normalizeName(icon.title) === company || normalizeName(icon.title) === normalizeName(site.split(".")[0]!));
}

export function linkCandidates(
  html: string,
  base: string,
): { url: string; source: LogoSourceKind; manifest?: boolean; tint?: string }[] {
  const found: { url: string; source: LogoSourceKind; manifest?: boolean; tint?: string }[] = [];
  const head = html.slice(0, 400_000);
  for (const tag of head.match(/<link\b[^>]*>/gi) ?? []) {
    const rel = /\brel\s*=\s*["']?([^"'>]+)/i.exec(tag)?.[1]?.toLowerCase() ?? "";
    const href = /\bhref\s*=\s*["']?([^"'\s>]+)/i.exec(tag)?.[1];
    if (!href) continue;
    const url = safeUrl(href, base)?.href;
    if (!url) continue;
    if (/apple-touch-icon/.test(rel)) found.push({ url, source: "apple-touch-icon" });
    else if (rel === "mask-icon") {
      // Safari pinned-tab icons are single-colour vectors; the brand colour is an attribute.
      const color = /\bcolor\s*=\s*["']?(#[0-9a-f]{6})\b/i.exec(tag)?.[1];
      found.push({ url, source: "site-icon", ...(color ? { tint: color } : {}) });
    }
    else if (/(^|\s)icon(\s|$)/.test(rel) || rel === "shortcut icon") found.push({ url, source: "site-icon" });
    else if (rel === "manifest") found.push({ url, source: "manifest", manifest: true });
  }
  return found;
}

export class LogoDiscovery {
  private simpleIcons?: Promise<SimpleIcon[]>;

  constructor(private readonly fetcher: Fetcher = fetch) {}

  private icons(): Promise<SimpleIcon[]> {
    this.simpleIcons ??= fetchBytes(this.fetcher, `${SIMPLE_ICONS}/data/simple-icons.json`, 4_000_000).then(
      (result) => {
        try {
          const parsed = JSON.parse(new TextDecoder().decode(result?.bytes)) as unknown;
          const list = Array.isArray(parsed) ? parsed : (parsed as { icons?: unknown }).icons;
          return Array.isArray(list) ? (list as SimpleIcon[]) : [];
        } catch {
          return [];
        }
      },
    );
    return this.simpleIcons;
  }

  async discover(request: LogoRequest): Promise<DiscoveryResult> {
    const notes: string[] = [];
    const urls: { url: string; source: LogoSourceKind; tint?: string }[] = [];
    const add = (url: string | undefined, source: LogoSourceKind, tint?: string) => {
      if (url && !urls.some((u) => u.url === url)) urls.push({ url, source, tint });
    };
    let siteStatus: DiscoveryResult["siteStatus"] = request.domain ? "unreachable" : "none";
    let redirectedTo: string | undefined;
    if (request.domain) {
      const home = await fetchBytes(this.fetcher, `https://${request.domain}/`, MAX_HTML);
      if (home) {
        const html = new TextDecoder().decode(home.bytes);
        const finalHost = new URL(home.url).hostname;
        // Same brand on another TLD (thekollection.com → .org) is still the company's own site.
        const brand = (host: string) => registrable(host).split(".")[0];
        if (brand(finalHost) !== brand(request.domain)) {
          siteStatus = "redirected";
          redirectedTo = finalHost.replace(/^www\./, "");
          notes.push(`${request.domain} now redirects to ${redirectedTo}; its icons belong to that site, so they were not used.`);
        } else if (PARKED.some((pattern) => pattern.test(html.slice(0, 200_000)))) {
          siteStatus = "parked";
          notes.push(`${request.domain} looks like a parked or for-sale domain, so its icons were not used.`);
        } else {
          siteStatus = "ok";
          const origin = new URL(home.url).origin;
          for (const link of linkCandidates(html, home.url)) {
            if (!link.manifest) {
              add(link.url, link.source, link.tint);
              continue;
            }
            const manifest = await fetchBytes(this.fetcher, link.url, 500_000);
            try {
              const icons = (JSON.parse(new TextDecoder().decode(manifest?.bytes)) as { icons?: { src?: string }[] }).icons ?? [];
              for (const icon of icons.slice(0, 20)) if (icon.src) add(safeUrl(icon.src, manifest!.url)?.href, "manifest");
            } catch {
              // Ignore malformed manifests.
            }
          }
          add(`${origin}/apple-touch-icon.png`, "apple-touch-icon");
          add(`${origin}/favicon.svg`, "site-icon");
          add(`${origin}/favicon.ico`, "site-icon");
        }
      } else {
        // Many large sites block automated page requests but still serve their icons.
        add(`https://${request.domain}/apple-touch-icon.png`, "apple-touch-icon");
        add(`https://${request.domain}/favicon.ico`, "site-icon");
      }
    }
    if (request.github && /^[a-z0-9](?:[a-z0-9-]{0,38})$/i.test(request.github))
      add(`https://github.com/${request.github}.png?size=460`, "github-avatar");
    const icon = matchSimpleIcon(await this.icons(), request);
    if (icon) add(`${SIMPLE_ICONS}/icons/${slugFor(icon)}.svg`, "simple-icons", `#${icon.hex}`);
    if (request.domain && (siteStatus === "ok" || siteStatus === "unreachable"))
      add(`https://www.google.com/s2/favicons?domain=${encodeURIComponent(request.domain)}&sz=256`, "favicon-service");

    const candidates: LogoCandidateInput[] = [];
    const fetched = await Promise.all(urls.slice(0, 16).map((u) => fetchBytes(this.fetcher, u.url)));
    fetched.forEach((result, index) => {
      if (result) candidates.push({ source: urls[index]!.source, url: result.url, bytes: result.bytes, tint: urls[index]!.tint });
    });
    return { candidates, notes, siteStatus, ...(redirectedTo ? { redirectedTo } : {}) };
  }
}
