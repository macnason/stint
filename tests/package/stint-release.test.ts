import { createHash } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { DEFAULT_VISIBILITY, releaseCandidate } from "../../scripts/stint-release.mjs";

function createClock() {
  const delays: number[] = [];
  return {
    delays,
    sleep: async (ms: number) => {
      delays.push(ms);
    },
  };
}

const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe("stint release transaction", () => {
  it("reconciles an immutable partial next publish without separate tag writes", async () => {
    const candidate = createCandidate("next");
    const registry = createRegistry(candidate.packages, {
      initialTags: { next: "0.9.0", latest: "0.8.0" },
      failPublishOnce: candidate.packages[1].name,
    });

    await expect(
      releaseCandidate({
        channel: "next",
        manifestPath: candidate.path,
        runNpm: registry.run,
      }),
    ).rejects.toThrow("injected publish failure");
    expect(registry.tags(candidate.packages[0].name)).toMatchObject({
      next: "1.0.0-next.0",
    });
    expect(registry.tags(candidate.packages[1].name)).toMatchObject({ next: "0.9.0" });

    await releaseCandidate({
      channel: "next",
      manifestPath: candidate.path,
      runNpm: registry.run,
    });

    expect(registry.tags(candidate.packages[0].name)).toMatchObject({
      next: "1.0.0-next.0",
      latest: "0.8.0",
    });
    expect(registry.tags(candidate.packages[1].name)).toMatchObject({
      next: "1.0.0-next.0",
      latest: "0.8.0",
    });
    expect(registry.publishCount(candidate.packages[0].name)).toBe(1);
    expect(registry.publishCount(candidate.packages[1].name)).toBe(2);
    expect(
      registry.commands.some(
        (args) => args[0] === "dist-tag" && args[1] === "add" && args[3] === "next",
      ),
    ).toBe(false);
  });

  // Reproduces the production failure: registry.npmjs.org serves packuments from a
  // CDN with `cache-control: max-age=300`, so reads issued seconds after a
  // successful publish can still 404 the version that was just written.
  it("waits out a registry that has not yet propagated a fresh publish", async () => {
    const candidate = createCandidate("next");
    const registry = createRegistry(candidate.packages, {
      initialTags: {},
      staleVersionReadsAfterPublish: 3,
    });
    const clock = createClock();

    await releaseCandidate({
      channel: "next",
      manifestPath: candidate.path,
      runNpm: registry.run,
      visibility: { attempts: 14, initialDelayMs: 2000, maxDelayMs: 60000 },
      sleep: clock.sleep,
      log: () => {},
    });

    for (const packageEntry of candidate.packages) {
      expect(registry.tags(packageEntry.name)).toMatchObject({ next: "1.0.0-next.0" });
      expect(registry.publishCount(packageEntry.name)).toBe(1);
    }
    // Backoff is exponential and never re-publishes while it waits.
    expect(clock.delays).toEqual([2000, 4000, 8000, 2000, 4000, 8000]);
  });

  it("waits out a dist-tag read that still points at the previous version", async () => {
    const candidate = createCandidate("next");
    const registry = createRegistry(candidate.packages, {
      initialTags: { next: "0.9.0" },
      staleTagReadsAfterPublish: 2,
    });
    const clock = createClock();

    await releaseCandidate({
      channel: "next",
      manifestPath: candidate.path,
      runNpm: registry.run,
      visibility: { attempts: 14, initialDelayMs: 2000, maxDelayMs: 60000 },
      sleep: clock.sleep,
      log: () => {},
    });

    for (const packageEntry of candidate.packages) {
      expect(registry.tags(packageEntry.name)).toMatchObject({ next: "1.0.0-next.0" });
    }
  });

  it("caps the wait and reports the reason when a publish never becomes visible", async () => {
    const candidate = createCandidate("next");
    const registry = createRegistry(candidate.packages, {
      initialTags: {},
      staleVersionReadsAfterPublish: Number.POSITIVE_INFINITY,
    });
    const clock = createClock();

    await expect(
      releaseCandidate({
        channel: "next",
        manifestPath: candidate.path,
        runNpm: registry.run,
        visibility: { attempts: 4, initialDelayMs: 1000, maxDelayMs: 2000 },
        sleep: clock.sleep,
        log: () => {},
      }),
    ).rejects.toThrow(/timed out after 4 attempts .* is not visible yet/s);
    expect(clock.delays).toEqual([1000, 2000, 2000]);
  });

  it("fails fast on mismatched published bytes instead of retrying", async () => {
    const candidate = createCandidate("next");
    const registry = createRegistry(candidate.packages, { initialTags: {} });
    registry.corruptOnPublish(candidate.packages[0].name);
    const clock = createClock();

    await expect(
      releaseCandidate({
        channel: "next",
        manifestPath: candidate.path,
        runNpm: registry.run,
        visibility: { attempts: 14, initialDelayMs: 2000, maxDelayMs: 60000 },
        sleep: clock.sleep,
        log: () => {},
      }),
    ).rejects.toThrow("registry integrity mismatch");
    // Corruption is not propagation lag, so it must not burn the retry budget.
    expect(clock.delays).toEqual([]);
  });

  it("keeps the retry budget above the registry's 300s CDN max-age", () => {
    const { attempts, initialDelayMs, maxDelayMs } = DEFAULT_VISIBILITY;
    let delay = initialDelayMs;
    let budget = 0;
    for (let attempt = 1; attempt < attempts; attempt += 1) {
      budget += delay;
      delay = Math.min(delay * 2, maxDelayMs);
    }
    expect(budget).toBeGreaterThan(300_000);
  });

  it("compares every next package's registry integrity before changing latest", async () => {
    const candidate = createCandidate("latest");
    const registry = createRegistry(candidate.packages, {
      initialTags: { next: "1.0.0-next.0", latest: "0.9.0" },
    });
    registry.setIntegrity(candidate.packages[1].name, "sha512-wrong");

    await expect(
      releaseCandidate({
        channel: "latest",
        manifestPath: candidate.path,
        runNpm: registry.run,
      }),
    ).rejects.toThrow("next bytes do not match the verified candidate");
    for (const packageEntry of candidate.packages) {
      expect(registry.tags(packageEntry.name).latest).toBe("0.9.0");
    }
    expect(registry.commands.some((args) => args[0] === "dist-tag" && args[1] === "add")).toBe(
      false,
    );
  });

  // Run 30903618222 hit this for real: the OIDC credential from `npm publish` does
  // not carry over to `npm dist-tag`, and the old code rolled back a tag it had
  // never written, burying the real cause under a restoration AggregateError.
  it("reports an unauthorized promotion clearly and rolls nothing back", async () => {
    const candidate = createCandidate("latest");
    const registry = createRegistry(candidate.packages, {
      initialTags: { next: "1.0.0-next.0", latest: "0.9.0" },
      unauthorizedTags: true,
    });

    const error = await releaseCandidate({
      channel: "latest",
      manifestPath: candidate.path,
      runNpm: registry.run,
      sleep: async () => {},
      log: () => {},
    }).catch((thrown: Error) => thrown);

    expect(error).not.toBeInstanceOf(AggregateError);
    expect(error.message).toContain("Trusted publishing authenticates `npm publish`");
    expect(error.message).toContain("npm dist-tag add @macworks/stint@1.0.0-next.0 latest");
    // Nothing was written, so nothing may be restored.
    expect(registry.tags(candidate.packages[0].name).latest).toBe("0.9.0");
    expect(
      registry.commands.filter((args) => args[0] === "dist-tag" && args[1] === "add"),
    ).toHaveLength(1);
  });

  it("restores both latest tags when the second promotion fails", async () => {
    const candidate = createCandidate("latest");
    const registry = createRegistry(candidate.packages, {
      initialTags: { next: "1.0.0-next.0", latest: "0.9.0" },
      failTagOnce: `${candidate.packages[1].name}:latest`,
    });

    await expect(
      releaseCandidate({
        channel: "latest",
        manifestPath: candidate.path,
        runNpm: registry.run,
      }),
    ).rejects.toThrow("injected tag failure");
    for (const packageEntry of candidate.packages) {
      expect(registry.tags(packageEntry.name).latest).toBe("0.9.0");
    }
  });
});

type CandidatePackage = {
  role: string;
  name: string;
  version: string;
  file: string;
  sha256: string;
  integrity: string;
};

function createCandidate(channel: "next" | "latest"): {
  path: string;
  packages: CandidatePackage[];
} {
  const directory = mkdtempSync(join(tmpdir(), "stint-release-helper-"));
  temporaryDirectories.push(directory);
  const packages = [
    packageEntry(directory, "runtime", "@macworks/stint", "runtime.tgz"),
    packageEntry(directory, "cli", "@macworks/stint-cli", "cli.tgz"),
  ];
  const path = join(directory, "release-candidate.json");
  writeFileSync(
    path,
    `${JSON.stringify({ schemaVersion: 1, channel, packages }, null, 2)}\n`,
  );
  return { path, packages };
}

function packageEntry(
  directory: string,
  role: string,
  name: string,
  file: string,
): CandidatePackage {
  const bytes = Buffer.from(`candidate:${name}`);
  writeFileSync(join(directory, file), bytes);
  return {
    role,
    name,
    version: "1.0.0-next.0",
    file,
    sha256: createHash("sha256").update(bytes).digest("hex"),
    integrity: `sha512-${createHash("sha512").update(bytes).digest("base64")}`,
  };
}

function createRegistry(
  packages: CandidatePackage[],
  options: {
    initialTags: Record<string, string>;
    failPublishOnce?: string;
    failTagOnce?: string;
    // Number of post-publish reads that still observe the pre-publish packument,
    // mirroring a CDN edge that has not yet caught up with the origin write.
    staleVersionReadsAfterPublish?: number;
    staleTagReadsAfterPublish?: number;
    // Mirrors a registry that accepts OIDC publishes but rejects dist-tag writes.
    unauthorizedTags?: boolean;
  },
) {
  const records = new Map(
    packages.map((candidate) => [
      candidate.name,
      {
        tags: { ...options.initialTags },
        versions: options.initialTags.next === candidate.version
          ? new Map([[candidate.version, candidate.integrity]])
          : new Map<string, string>(),
      },
    ]),
  );
  const publishCounts = new Map<string, number>();
  let failPublishOnce = options.failPublishOnce;
  let failTagOnce = options.failTagOnce;
  const commands: string[][] = [];
  // Per-package countdowns of remaining stale reads, armed by a successful publish.
  const staleVersionReads = new Map<string, number>();
  const staleTagReads = new Map<string, number>();
  const corruptOnPublish = new Set<string>();

  function consumeStale(counters: Map<string, number>, name: string): boolean {
    const remaining = counters.get(name) ?? 0;
    if (remaining <= 0) return false;
    counters.set(name, remaining - 1);
    return true;
  }

  async function run(args: string[]): Promise<string> {
    commands.push(args);
    if (args[0] === "view" && args[2] === "dist.integrity") {
      const { name, version } = splitSpec(args[1]);
      if (consumeStale(staleVersionReads, name)) throw missing();
      const integrity = records.get(name)?.versions.get(version);
      if (!integrity) throw missing();
      return JSON.stringify(integrity);
    }
    if (args[0] === "view" && args[2] === "dist-tags") {
      const record = records.get(args[1]);
      if (!record) throw missing();
      if (consumeStale(staleTagReads, args[1])) {
        return JSON.stringify({ ...record.tags, ...options.initialTags });
      }
      return JSON.stringify(record.tags);
    }
    if (args[0] === "publish") {
      const file = resolve(args.at(-1)!);
      const candidate = packages.find((entry) => file.endsWith(entry.file))!;
      publishCounts.set(candidate.name, (publishCounts.get(candidate.name) ?? 0) + 1);
      if (failPublishOnce === candidate.name) {
        failPublishOnce = undefined;
        throw new Error("injected publish failure");
      }
      const record = records.get(candidate.name)!;
      record.versions.set(
        candidate.version,
        corruptOnPublish.has(candidate.name) ? "sha512-corrupted" : candidate.integrity,
      );
      record.tags.next = candidate.version;
      if (options.staleVersionReadsAfterPublish) {
        staleVersionReads.set(candidate.name, options.staleVersionReadsAfterPublish);
      }
      if (options.staleTagReadsAfterPublish) {
        staleTagReads.set(candidate.name, options.staleTagReadsAfterPublish);
      }
      return JSON.stringify({
        name: candidate.file,
        version: candidate.version,
        files: [],
      });
    }
    if (args[0] === "dist-tag" && args[1] === "add") {
      const { name, version } = splitSpec(args[2]);
      const tag = args[3];
      if (options.unauthorizedTags) {
        throw Object.assign(new Error("Command failed: npm dist-tag add"), {
          stderr: "npm error code E401\nnpm error 401 Unauthorized - PUT https://registry.npmjs.org/",
        });
      }
      if (failTagOnce === `${name}:${tag}`) {
        failTagOnce = undefined;
        throw new Error("injected tag failure");
      }
      records.get(name)!.tags[tag] = version;
      return "";
    }
    if (args[0] === "dist-tag" && args[1] === "rm") {
      delete records.get(args[2])!.tags[args[3]];
      return "";
    }
    throw new Error(`unexpected npm command: ${args.join(" ")}`);
  }

  return {
    run,
    commands,
    tags: (name: string) => records.get(name)!.tags,
    publishCount: (name: string) => publishCounts.get(name) ?? 0,
    setIntegrity: (name: string, integrity: string) => {
      records.get(name)!.versions.set("1.0.0-next.0", integrity);
    },
    corruptOnPublish: (name: string) => corruptOnPublish.add(name),
  };
}

function splitSpec(spec: string): { name: string; version: string } {
  const separator = spec.lastIndexOf("@");
  return { name: spec.slice(0, separator), version: spec.slice(separator + 1) };
}

function missing(): Error & { stderr: string } {
  return Object.assign(new Error("E404"), { stderr: "404 Not Found" });
}
