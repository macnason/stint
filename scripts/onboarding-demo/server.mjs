import { createServer as httpServer } from "node:http";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, cpSync, existsSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
import { createServer as viteServer } from "vite";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "../..");
const workspace = mkdtempSync(join(tmpdir(), "stint-onboarding-demo-"));
const artifacts = join(workspace, "packages");
const project = join(workspace, "new-portfolio");
mkdirSync(artifacts); mkdirSync(join(project, "src"), { recursive: true });
writeFileSync(join(project, "package.json"), JSON.stringify({ name: "new-portfolio", private: true, version: "0.0.0", type: "module", scripts: { build: "vite build --base=/project/" } }, null, 2));
writeFileSync(join(project, "index.html"), '<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>My career · Stint</title><div id="root"></div><script type="module" src="/src/main.tsx"></script></html>');
cpSync(join(root, "packages/stint-cli/test/fixtures/documents/grouped-profile.png"), join(project, "experience.png"));
let vite;
let step = 0, busy = false;
const history = [];
async function run(command, args, cwd = project) {
  return new Promise((resolveRun, reject) => {
    const child = spawn(command, args, { cwd, env: { ...process.env, FORCE_COLOR: "0", NO_COLOR: "1" }, timeout: 120_000 });
    let stdout = "", stderr = "";
    child.stdout.on("data", data => { stdout += data; });
    child.stderr.on("data", data => { stderr += data; });
    child.on("error", reject);
    child.on("close", code => code === 0 ? resolveRun(stdout) : reject(new Error(`${command} failed (${code})\n${stderr}`)));
  });
}
for (const name of ["stint", "stint-cli"]) await run("npm", ["pack", "--workspace", `packages/${name}`, "--pack-destination", artifacts], root);
const tarballs = readdirSync(artifacts).filter(name => name.endsWith(".tgz")).map(name => join(artifacts, name));
const cli = (...args) => run(process.execPath, [join(project, "node_modules/@macworks/stint-cli/dist/cli.js"), ...args, "--json"]);
const commands = [
  "npm install ./packages/macworks-stint*.tgz react@19 react-dom@19 vite@8 typescript@5",
  "stint doctor --json",
  "stint setup https://www.linkedin.com/in/example --json",
  "stint extract experience.png --output draft.json --json",
  "stint setup draft.json --json",
  "stint setup draft.json --apply --json",
  "# Import the generated stintConfig into React\nnpm run build",
];
function compact(result) {
  if (result.draft) return { state: result.state, extraction: result.extraction, employers: result.draft.entries.map(e => ({ company: e.company, from: e.start, to: e.end ?? "Present", roles: e.roles.map(r => `${r.title} (${r.start})`) })), review: result.warnings?.filter(w => w.code !== "missing-presentation").map(w => w.message), actions: result.actions };
  if (result.onboarding) return { state: result.state, framework: result.framework, capabilities: result.capabilities, recommendation: result.onboarding.route, next: result.onboarding.next };
  return { state: result.state, importedEntries: result.importedEntries, dryRun: result.dryRun, actions: result.actions };
}
async function advance() {
  const started = performance.now();
  let output, result;
  switch (step) {
    case 0:
      output = await run("npm", ["install", "--ignore-scripts", "--no-audit", "--no-fund", ...tarballs, "react@19", "react-dom@19", "vite@8", "typescript@5"]);
      output += "\nInstalled the unpublished PR tarballs in a fresh project.\nNo Stint config or generated data exists yet.";
      break;
    case 1: result = JSON.parse(await cli("doctor")); break;
    case 2: result = JSON.parse(await cli("setup", "https://www.linkedin.com/in/example")); break;
    case 3: result = JSON.parse(await cli("extract", "experience.png", "--output", "draft.json")); break;
    case 4: result = JSON.parse(await cli("setup", "draft.json")); break;
    case 5: result = JSON.parse(await cli("setup", "draft.json", "--apply")); break;
    case 6:
      writeFileSync(join(project, "src/main.tsx"), readFileSync(join(here, "main.tsx")));
      output = await run("npm", ["run", "build"]);
      vite = await viteServer({ root: project, base: "/project/", configFile: false, server: { middlewareMode: true, allowedHosts: ["mac.tail451f23.ts.net"], fs: { strict: true, allow: [project] } }, appType: "spa" });
      break;
    default: throw new Error("Walkthrough complete");
  }
  if (result) output = JSON.stringify(compact(result), null, 2);
  const entry = { step, command: commands[step], output: output.replaceAll(workspace, "[demo]"), durationMs: Math.round(performance.now() - started), data: result ? compact(result) : undefined, configWritten: existsSync(join(project, "stint.config.json")) };
  history.push(entry); step++;
  return entry;
}
const server = httpServer(async (req, res) => {
  const path = new URL(req.url, "http://127.0.0.1").pathname;
  if (path.startsWith("/project/") && vite) return vite.middlewares(req, res, () => { res.writeHead(404).end(); });
  const json = (code, value) => { res.writeHead(code, { "Content-Type": "application/json", "Cache-Control": "no-store" }); res.end(JSON.stringify(value)); };
  if (path === "/api/state" && req.method === "GET") return json(200, { step, busy, history });
  if (path === "/api/step" && req.method === "POST") {
    if (req.headers.origin !== `http://${req.headers.host}`) return json(403, { error: "Same-origin demo actions only" });
    if (busy || step >= commands.length) return json(409, { error: "No action available" });
    busy = true;
    try { json(200, await advance()); } catch (error) { json(500, { error: error.message }); } finally { busy = false; }
    return;
  }
  if (path === "/experience.png") { res.writeHead(200, { "Content-Type": "image/png" }); res.end(readFileSync(join(project, "experience.png"))); return; }
  if (path === "/" || path === "/index.html") { res.writeHead(200, { "Content-Type": "text/html", "Cache-Control": "no-store" }); res.end(readFileSync(join(here, "index.html"))); return; }
  res.writeHead(404).end();
});
server.listen(Number(process.env.PORT ?? 4187), "127.0.0.1", () => console.log(JSON.stringify({ project, port: process.env.PORT ?? 4187 })));
