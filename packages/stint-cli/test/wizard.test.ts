import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startWizard } from "../src/wizard/server.js";

const sessions: Awaited<ReturnType<typeof startWizard>>[] = [];
const roots: string[] = [];
afterEach(async () => {
  await Promise.all(sessions.splice(0).map(s => s.close()));
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});
const history = { schemaVersion: 1, entries: [{ id: "studio", company: "Example Studio", start: "2020-01", end: null, roles: [{ id: "designer", title: "Designer", start: "2020-01" }] }] };
async function session() {
  const root = mkdtempSync(join(tmpdir(), "stint-wizard-test-")); roots.push(root);
  mkdirSync(join(root, "src"));
  writeFileSync(join(root, "package.json"), JSON.stringify({ name: "designer-portfolio", dependencies: { vite: "8", "@macworks/stint": "1.0.0-next.3" } }));
  const wizard = await startWizard(root); sessions.push(wizard);
  const url = new URL(wizard.url);
  const request = (path: string, body?: BodyInit, headers: Record<string, string> = {}) => fetch(url.origin + path, { method: body === undefined ? "GET" : "POST", headers: { Authorization: `Bearer ${url.hash.slice(1)}`, Origin: url.origin, ...headers }, body });
  return { root, url, request };
}

describe("designer upload wizard", () => {
  it("serves the bundled file picker but protects session data and mutations", async () => {
    const { request, url } = await session();
    const page = await fetch(url.origin);
    expect(await page.text()).toContain('type="file"');
    expect(page.headers.get("content-security-policy")).toContain("frame-ancestors 'none'");
    expect((await fetch(url.origin + "/api/state")).status).toBe(401);
    expect((await request("/api/upload?name=history.json", JSON.stringify(history), { Origin: "https://attacker.example" })).status).toBe(403);
    expect((await request("/api/apply", "")).status).toBe(400);
  });

  it("uploads a file, accepts reviewed corrections, then applies exactly once", async () => {
    const { root, request } = await session();
    const upload = await request("/api/upload?name=../../history.json", JSON.stringify(history));
    expect(await upload.json()).toMatchObject({ stage: "review", draft: history });
    expect(existsSync(join(root, "stint.config.json"))).toBe(false);
    const revised = structuredClone(history); revised.entries[0].company = "Reviewed Studio";
    const preview = await request("/api/review", JSON.stringify(revised));
    expect((await preview.json()).stage).toBe("ready");
    expect(existsSync(join(root, "stint.config.json"))).toBe(false);
    const applied = await request("/api/apply", "");
    expect((await applied.json()).stage).toBe("complete");
    expect(JSON.parse(readFileSync(join(root, "stint.config.json"), "utf8")).entries[0].company).toBe("Reviewed Studio");
    expect(existsSync(join(root, "src/stint.data.ts"))).toBe(true);
    expect((await request("/api/apply", "")).status).toBe(409);
    expect((await request("/api/upload?name=history.json", JSON.stringify(history))).status).toBe(409);
  });

  it("runs the real local screenshot extractor through upload", async () => {
    const { request } = await session();
    const source = readFileSync(new URL("./fixtures/documents/grouped-profile.png", import.meta.url));
    const result = await request("/api/upload?name=experience.png", source);
    const data = await result.json();
    expect(result.status).toBe(200);
    expect(data.draft.entries).toHaveLength(3);
    expect(data.draft.entries.reduce((n: number, e: {roles: unknown[]}) => n + e.roles.length, 0)).toBe(5);
  }, 20_000);

  it("rejects unsupported, oversized, empty, and invalid histories without writing", async () => {
    const { root, request } = await session();
    expect((await request("/api/upload?name=script.js", "alert(1)")).status).toBe(400);
    expect((await request("/api/upload?name=large.png", Buffer.alloc(8 * 1024 * 1024 + 1))).status).toBe(400);
    expect((await request("/api/upload?name=empty.json", '{"schemaVersion":1,"entries":[]}')).status).toBe(400);
    expect((await request("/api/upload?name=history.json", JSON.stringify(history))).status).toBe(200);
    const invalid = structuredClone(history); invalid.entries[0].start = "bad";
    expect((await request("/api/review", JSON.stringify(invalid))).status).toBe(400);
    expect((await request("/api/apply", "")).status).toBe(400);
    expect(existsSync(join(root, "stint.config.json"))).toBe(false);
  });

  it("does not overwrite an existing project history", async () => {
    const { root, request } = await session();
    writeFileSync(join(root, "stint.config.json"), "keep me");
    await request("/api/upload?name=history.json", JSON.stringify(history));
    expect((await request("/api/review", JSON.stringify(history))).status).toBe(400);
    expect((await request("/api/apply", "")).status).toBe(400);
    expect(readFileSync(join(root, "stint.config.json"), "utf8")).toBe("keep me");
  });
});
