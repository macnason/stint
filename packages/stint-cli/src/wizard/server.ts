import { createServer, type IncomingMessage } from "node:http";
import { randomBytes } from "node:crypto";
import { readFileSync, writeFileSync, unlinkSync } from "node:fs";
import { extname, join } from "node:path";
import { setupCommand } from "../commands/setup.js";
import { parseImport, resolveFormat } from "../commands/import.js";
import { parseJsonImport } from "../importers/json.js";
import { validateConfig, currentUtcMonth } from "../config.js";
import { inspectProject } from "../project.js";
import { CliError } from "../diagnostics.js";
import { createSetupSession, cleanupSetupSession } from "../setup/session.js";

const MAX_UPLOAD = 8 * 1024 * 1024;
const quietIo = { isTTY: false, writeOut() {}, writeError() {} };

/** A single-project, short-lived upload session; no filesystem or shell API. */
export async function startWizard(projectPath: string, port = 0) {
  const inspection = inspectProject(projectPath);
  const session = createSetupSession();
  const token = randomBytes(32).toString("hex");
  const html = readFileSync(new URL("./index.html", import.meta.url));
  let state: Record<string, unknown> = { stage: "upload", project: inspection.project.manifest?.name ?? "your project" };
  let busy = false;
  let closed = false;
  const draftPath = join(session.directory, "draft.json");
  const setup = (apply: boolean) => setupCommand({ positionals: [draftPath], values: { project: inspection.project.root }, flags: new Set(apply ? ["apply"] : []) }, quietIo);
  const server = createServer(async (req, res) => {
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("Referrer-Policy", "no-referrer");
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Content-Security-Policy", "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; connect-src 'self'; img-src 'self' data:; base-uri 'none'; frame-ancestors 'none'; form-action 'self'");
    const json = (status: number, data: unknown) => { res.writeHead(status, { "Content-Type": "application/json" }); res.end(JSON.stringify(data)); };
    const url = new URL(req.url ?? "/", "http://localhost");
    if (url.pathname === "/" && req.method === "GET") { res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" }); res.end(html); return; }
    if (req.headers.authorization !== `Bearer ${token}`) return json(401, { error: "Open the setup link your agent shared to continue." });
    if (req.method === "GET" && url.pathname === "/api/state") return json(200, { ...state, busy });
    if (req.method !== "POST") return json(404, { error: "Not found" });
    // A token is required even for loopback. Same-origin also protects private forwarders.
    let origin: URL;
    try { origin = new URL(req.headers.origin ?? ""); } catch { return json(403, { error: "Open setup in its own browser tab." }); }
    if (!["http:", "https:"].includes(origin.protocol) || origin.host !== req.headers.host) return json(403, { error: "Open setup in its own browser tab." });
    if (busy) return json(409, { error: "Your history is still being processed. Please wait." });
    if (state.stage === "complete") return json(409, { error: "Your history has already been saved." });
    if (!["/api/upload", "/api/review", "/api/apply"].includes(url.pathname)) return json(404, { error: "Not found" });
    busy = true;
    try {
      if (url.pathname === "/api/upload") {
        const extension = extname(url.searchParams.get("name") ?? "").toLowerCase();
        if (![".pdf", ".png", ".jpg", ".jpeg", ".json", ".csv", ".zip", ".yaml", ".yml"].includes(extension)) throw new CliError("E_IMPORT_FORMAT", "Choose a PDF, PNG or JPG screenshot, or a LinkedIn export.");
        const source = await body(req, MAX_UPLOAD);
        const imported = await parseImport(source, `upload${extension}`, resolveFormat(`upload${extension}`));
        const validation = validateConfig(imported.config, currentUtcMonth());
        if (!validation.valid || !imported.config.entries.length) throw new CliError("E_IMPORT_SCHEMA", "We couldn't find a complete work history. Try a clearer Experience screenshot or attach your history in the agent chat.");
        state = { stage: "review", project: state.project, draft: imported.config, warnings: [...imported.warnings, ...validation.warnings].filter(w => w.code !== "missing-presentation") };
      } else if (url.pathname === "/api/review") {
        if (state.stage !== "review" && state.stage !== "ready") throw new CliError("E_COMMAND", "Choose your history file first.");
        const { config } = parseJsonImport(await body(req, 1024 * 1024), "review");
        const validation = validateConfig(config, currentUtcMonth());
        if (!validation.valid || !config.entries.length) throw new CliError("E_CONFIG_INVALID", validation.errors[0]?.message ?? "Add at least one experience.");
        state = { stage: "review", project: state.project, draft: config, warnings: validation.warnings };
        writeFileSync(draftPath, JSON.stringify(config), { mode: 0o600 });
        const preview = await setup(false);
        if (preview.payload.state !== "ready_to_apply") throw new CliError("E_PROJECT", "Your agent needs to finish connecting this project. Return to the chat; your history is ready for them.");
        state = { stage: "ready", project: state.project, draft: config, warnings: preview.payload.warnings, plan: preview.payload };
      } else {
        // Only the exact draft reviewed in this session can be applied. Ignore no body.
        const bytes = await body(req, 0);
        if (bytes.length || state.stage !== "ready") throw new CliError("E_COMMAND", "Review your history before saving it.");
        const result = await setup(true);
        if (result.payload.state !== "complete") throw new CliError("E_PROJECT", "Setup couldn't finish. Your agent can help you continue from here.");
        state = { stage: "complete", project: state.project, result: result.payload };
        unlinkSync(draftPath);
      }
      json(200, state);
    } catch (error) {
      json(400, { error: error instanceof CliError ? error.message : "We couldn't finish that step. Try again, or ask your agent for help." });
    } finally { busy = false; }
  });
  server.requestTimeout = 120_000;
  server.headersTimeout = 15_000;
  const close = async () => {
    if (closed) return;
    closed = true;
    clearTimeout(expiry);
    await new Promise<void>(resolve => { server.close(() => resolve()); server.closeIdleConnections(); });
    cleanupSetupSession(session);
  };
  const expiry = setTimeout(() => { void close(); }, 60 * 60 * 1000);
  expiry.unref();
  try {
    await new Promise<void>((resolve, reject) => { server.once("error", reject); server.listen(port, "127.0.0.1", resolve); });
  } catch (error) { clearTimeout(expiry); cleanupSetupSession(session); throw error; }
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Setup did not start");
  return { url: `http://127.0.0.1:${address.port}/#${token}`, port: address.port, close };
}

async function body(req: IncomingMessage, limit: number): Promise<Buffer> {
  if (Number(req.headers["content-length"]) > limit) { req.resume(); throw new CliError("E_IMPORT_LIMIT", limit ? "Choose a file smaller than 8 MB." : "This action does not accept a file."); }
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > limit) throw new CliError("E_IMPORT_LIMIT", "This file is too large. Choose a smaller file.");
    chunks.push(Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}
