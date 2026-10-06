import { createHash } from "node:crypto";
import { lstatSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, posix, resolve } from "node:path";
import type { StintConfig } from "@macworks/stint/schema";
import { readCanonicalConfig } from "../config.js";
import { CliError } from "../diagnostics.js";
import { LogoDiscovery, isValidDomain, type Fetcher, type LogoRequest } from "../logos/discover.js";
import { runLogoEngine } from "../logos/run.js";
import type { LogoCandidateInput, LogoEngineItem, LogoSurface } from "../logos/types.js";
import { rejectUnknownOptions, type ParsedOptions } from "../options.js";
import { inspectProject } from "../project.js";
import { renderLogosModule, type LogoModuleEntry } from "../templates/logos.js";
import { applyTransaction, isConflictPolicy, planTransaction, type ConflictPolicy } from "../transaction.js";
import type { CommandResult } from "./types.js";

const MAX_INPUT_BYTES = 256 * 1024;
const MAX_FILE_BYTES = 16 * 1024 * 1024;
const LOGO_DIR = "public/stint/logos";

interface LogoInputCompany extends LogoRequest {
  /** A logo file the person supplied (attachment or upload). */
  readonly file?: string;
}

export interface LogosCommandDependencies {
  readonly fetcher?: Fetcher;
}

function readLimited(path: string, limit: number, what: string): Buffer {
  try {
    const metadata = lstatSync(path);
    if (!metadata.isFile()) throw new Error("not a file");
    if (metadata.size > limit) throw new CliError("E_IMPORT_LIMIT", `The ${what} is too large.`, { path });
    return readFileSync(path);
  } catch (error) {
    if (error instanceof CliError) throw error;
    throw new CliError("E_NOT_FOUND", `The ${what} could not be read.`, { cause: error, path });
  }
}

function parseInput(path: string | undefined): LogoInputCompany[] {
  if (!path) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(readLimited(resolve(path), MAX_INPUT_BYTES, "logo input").toString("utf8"));
  } catch (error) {
    if (error instanceof CliError) throw error;
    throw new CliError("E_ANSWERS", "The logo input must be JSON.", { cause: error });
  }
  const companies = (parsed as { companies?: unknown }).companies;
  if ((parsed as { version?: unknown }).version !== 1 || !Array.isArray(companies) || companies.length > 200)
    throw new CliError("E_ANSWERS", 'The logo input must be {"version":1,"companies":[...]} with at most 200 companies.');
  return companies.map((raw, index) => {
    const value = raw as Record<string, unknown>;
    const text = (key: string) => (typeof value[key] === "string" && value[key] ? (value[key] as string).trim() : undefined);
    const company = text("company");
    if (!company) throw new CliError("E_ANSWERS", `Logo input company ${index + 1} needs a company name.`);
    const domain = text("domain")?.toLowerCase().replace(/^https?:\/\//, "").replace(/\/.*$/, "");
    if (domain && !isValidDomain(domain))
      throw new CliError("E_ANSWERS", `"${domain}" is not a public domain name.`);
    return { company, domain, github: text("github"), simpleIcon: text("simpleIcon"), file: text("file") };
  });
}

/**
 * Stage review files inside the project (node_modules/.cache, ignored by git) so agents
 * with working-directory sandboxes can open the review sheet without a permission prompt.
 */
function stagingDirectory(root: string, key: string): string {
  const make = (dir: string) => {
    mkdirSync(dir, { recursive: true, mode: 0o700 });
    if (!lstatSync(dir).isDirectory()) throw new Error("not a directory");
    return dir;
  };
  try {
    if (lstatSync(join(root, "node_modules")).isDirectory())
      return make(join(root, "node_modules", ".cache", "stint", `logos-${key}`));
  } catch {
    // Fall back to the system temp directory.
  }
  return make(join(tmpdir(), `stint-logos-${process.getuid?.() ?? "user"}-${key}`));
}

/** A staged review, so --apply writes exactly what was reviewed without fetching again. */
interface StagedReview {
  readonly version: 1;
  readonly payload: Record<string, unknown> & { logos: ReviewEntry[] };
  readonly writes: readonly { path: string; staged: string }[];
  readonly module?: { path: string; content: string };
}

interface ReviewEntry {
  readonly company: string;
  readonly confidence: string;
  readonly source?: string;
  readonly treatment?: string;
  readonly notes: string[];
}

const STAGE_TTL_MS = 60 * 60 * 1000;

function readStaged(staging: string): StagedReview | undefined {
  const path = join(staging, "review.json");
  try {
    if (Date.now() - statSync(path).mtimeMs > STAGE_TTL_MS) return undefined;
    const staged = JSON.parse(readFileSync(path, "utf8")) as StagedReview;
    return staged.version === 1 ? staged : undefined;
  } catch {
    return undefined;
  }
}

const normalizeName = (value: string) => value.toLowerCase().replace(/[^a-z0-9]/g, "");

export async function logosCommand(
  options: ParsedOptions,
  dependencies: LogosCommandDependencies = {},
): Promise<CommandResult> {
  rejectUnknownOptions(
    options,
    ["project", "config", "input", "screenshot", "surface", "conflict"],
    ["json", "apply", "offline"],
  );
  if (options.positionals.length)
    throw new CliError("E_COMMAND", "logos does not accept positional arguments.", { exitCode: 2 });
  const surface = (options.values.surface ?? "white") as LogoSurface;
  if (surface !== "white" && surface !== "transparent")
    throw new CliError("E_OPTION", "--surface must be white or transparent.", { exitCode: 2 });
  const conflict = options.values.conflict ?? "abort";
  if (!isConflictPolicy(conflict))
    throw new CliError("E_OPTION", "Conflict policy must be abort, skip, or overwrite.", { exitCode: 2 });

  const inspection = inspectProject(resolve(options.values.project ?? "."));
  const root = inspection.project.root;
  const config: StintConfig = readCanonicalConfig(root, options.values.config ?? inspection.likelyConfigPath);
  const input = parseInput(options.values.input);
  const byName = new Map(input.map((company) => [normalizeName(company.company), company]));
  const unmatched = input.filter((company) => !config.entries.some((e) => normalizeName(e.company) === normalizeName(company.company)));

  // Screenshot slots follow page order, which is the order the history was extracted in.
  const screenshot = options.values.screenshot
    ? readLimited(resolve(options.values.screenshot), MAX_FILE_BYTES, "screenshot")
    : undefined;

  const fileHashes = input.map((company) =>
    company.file ? createHash("sha256").update(readLimited(resolve(company.file), MAX_FILE_BYTES, "logo file")).digest("hex") : null,
  );
  const key = createHash("sha256")
    .update(
      JSON.stringify({
        entries: config.entries.map((e) => [e.id, e.company, e.start, e.end]),
        input,
        fileHashes,
        screenshot: screenshot ? createHash("sha256").update(screenshot).digest("hex") : null,
        surface,
        offline: options.flags.has("offline"),
      }),
    )
    .digest("hex")
    .slice(0, 16);
  const staging = stagingDirectory(root, key);
  const apply = options.flags.has("apply");
  const staged = apply ? readStaged(staging) : undefined;
  if (staged) return applyStaged(root, conflict, staging, staged);

  const discovery = new LogoDiscovery(dependencies.fetcher);
  const notes: Record<string, string[]> = {};
  const status: Record<string, string> = {};
  const items: LogoEngineItem[] = [];
  // LinkedIn lists employers by end date (current first), then by start date.
  const pageOrder = [...config.entries]
    .sort((a, b) => (b.end ?? "9999-99").localeCompare(a.end ?? "9999-99") || b.start.localeCompare(a.start))
    .map((entry) => entry.id);
  const queue = config.entries.map((entry, index) => ({ entry, index }));
  const workers = Array.from({ length: Math.min(4, queue.length) }, async () => {
    for (let next = queue.shift(); next; next = queue.shift()) {
      const { entry, index } = next;
      const request = byName.get(normalizeName(entry.company)) ?? { company: entry.company };
      const candidates: LogoCandidateInput[] = [];
      if ("file" in request && request.file)
        candidates.push({ source: "file", bytes: readLimited(resolve(request.file), MAX_FILE_BYTES, "logo file") });
      if (!options.flags.has("offline")) {
        const found = await discovery.discover(request);
        candidates.push(...found.candidates);
        notes[entry.id] = found.notes;
        status[entry.id] = found.siteStatus;
      }
      items[index] = { key: entry.id, candidates, ...(screenshot ? { screenshotSlot: pageOrder.indexOf(entry.id) } : {}) };
    }
  });
  await Promise.all(workers);

  const engine = await runLogoEngine({ items, surface, ...(screenshot ? { screenshot } : {}) });
  const slotCountMatches = !engine.screenshot || engine.screenshot.slots === config.entries.length;
  if (!slotCountMatches) {
    // Without a one-to-one match the crops could be assigned to the wrong employer; rerun without them.
    const withoutCrops = items.map(({ screenshotSlot: _slot, ...item }) => item);
    Object.assign(engine, await runLogoEngine({ items: withoutCrops, surface }));
  }

  const sheetPath = join(staging, "logo-review.png");
  writeFileSync(sheetPath, engine.sheet, { mode: 0o600 });

  const logos: Record<string, LogoModuleEntry> = {};
  const writes: { path: string; staged: string }[] = [];
  const review: ReviewEntry[] = config.entries.map((entry) => {
    const result = engine.results.find((r) => r.key === entry.id);
    const choice = result?.choice;
    const flags: string[] = [...(notes[entry.id] ?? [])];
    if (!choice) flags.push("No usable logo was found; the timeline shows the company initial.");
    else if (choice.confidence === "low")
      flags.push(`Only a ${choice.effectivePx}px image was available; ask for a better logo file if it looks soft.`);
    if (result?.png && choice) {
      const file = `${entry.id}.png`;
      const dark = result.pngDark ? `${entry.id}.dark.png` : undefined;
      writeFileSync(join(staging, file), result.png, { mode: 0o600 });
      writes.push({ path: posix.join(LOGO_DIR, file), staged: file });
      if (dark && result.pngDark) {
        writeFileSync(join(staging, dark), result.pngDark, { mode: 0o600 });
        writes.push({ path: posix.join(LOGO_DIR, dark), staged: dark });
      }
      logos[entry.id] = {
        src: `/stint/logos/${file}`,
        ...(dark ? { srcDark: `/stint/logos/${dark}` } : {}),
        treatment: choice.treatment,
        ...(choice.url ? { source: choice.url } : {}),
      };
    }
    return {
      id: entry.id,
      company: entry.company,
      ...(choice
        ? {
            source: choice.source,
            ...(choice.url ? { url: choice.url } : {}),
            treatment: choice.treatment,
            effectivePx: choice.effectivePx,
            confidence: choice.confidence,
            ...(choice.accent ? { accent: choice.accent } : {}),
            staged: join(staging, `${entry.id}.png`),
          }
        : { confidence: "none" }),
      ...(status[entry.id] ? { site: status[entry.id] } : {}),
      needsReview: !choice || choice.confidence === "low" || (notes[entry.id]?.length ?? 0) > 0,
      notes: flags,
    };
  });

  const dataPath = inspection.likelyDataPath;
  const modulePath = dataPath ? posix.join(posix.dirname(dataPath), "stint.logos.ts") : undefined;
  const module = modulePath ? { path: modulePath, content: renderLogosModule(logos) } : undefined;

  const summary = {
    found: review.filter((r) => r.source).length,
    needsReview: review.filter((r) => (r as { needsReview?: boolean }).needsReview).length,
    total: review.length,
  };
  const base = {
    ok: true,
    surface,
    summary,
    sheet: sheetPath,
    logos: review,
    ...(engine.screenshot
      ? {
          screenshot: {
            ...engine.screenshot,
            used: slotCountMatches,
            ...(slotCountMatches
              ? {}
              : { note: `Found ${engine.screenshot.slots} logo slots for ${config.entries.length} employers, so screenshot logos were not used.` }),
          },
        }
      : {}),
    ...(unmatched.length ? { unmatchedInput: unmatched.map((c) => c.company) } : {}),
    ...(modulePath ? {} : { handoff: "The project's framework was not recognised; copy the staged PNGs into a public folder and pass them to <Stint logos>." }),
  };

  const stagedReview: StagedReview = { version: 1, payload: base, writes, ...(module ? { module } : {}) };
  writeFileSync(join(staging, "review.json"), JSON.stringify(stagedReview), { mode: 0o600 });
  if (!apply) {
    return {
      payload: {
        ...base,
        state: "needs_review",
        staging,
        writes: [...writes.map((w) => w.path), ...(module ? [module.path] : [])],
        module: modulePath,
      },
      human: renderHuman(review, sheetPath, false),
    };
  }
  return applyStaged(root, conflict, staging, stagedReview);
}

function applyStaged(root: string, conflict: ConflictPolicy, staging: string, staged: StagedReview): CommandResult {
  if (!staged.module) throw new CliError("E_PROJECT", String(staged.payload.handoff ?? "Unsupported project."));
  const writes = [
    ...staged.writes.map((w) => ({ path: w.path, content: readFileSync(join(staging, w.staged)) })),
    { path: staged.module.path, content: Buffer.from(staged.module.content) },
  ];
  const plan = planTransaction({ projectRoot: root, conflict, writes });
  applyTransaction(plan);
  return {
    payload: {
      ...staged.payload,
      state: "complete",
      module: staged.module.path,
      actions: plan.actions.map(({ path, action, bytes }) => ({ path, action, bytes })),
      usage: `import { stintLogos } from "./${posix.basename(staged.module.path, ".ts")}"; <Stint data={stintConfig} logos={stintLogos} />`,
    },
    human: renderHuman(staged.payload.logos, String(staged.payload.sheet), true),
  };
}

function renderHuman(
  review: readonly ReviewEntry[],
  sheet: string,
  applied: boolean,
): string {
  const lines = review.map(
    (r) => `${r.confidence === "high" ? "✓" : r.confidence === "none" ? "·" : "!"} ${r.company} — ${r.source ? `${r.treatment} from ${r.source}` : "initial only"}${r.notes.length ? `\n    ${r.notes.join("\n    ")}` : ""}`,
  );
  return `${lines.join("\n")}\n\nReview sheet: ${sheet}\n${applied ? "Logos written." : "Nothing written yet. Rerun with --apply to add these logos to the project."}\n`;
}

export const logosDirectory = LOGO_DIR;
