import { createHash } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { releaseCandidate } from "../../scripts/stint-release.mjs";

const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe("stint release transaction", () => {
  it("restores both next tags after a partial publish and reconciles the retry", async () => {
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
    expect(registry.tags(candidate.packages[0].name)).toMatchObject({ next: "0.9.0" });
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

  async function run(args: string[]): Promise<string> {
    commands.push(args);
    if (args[0] === "view" && args[2] === "dist.integrity") {
      const { name, version } = splitSpec(args[1]);
      const integrity = records.get(name)?.versions.get(version);
      if (!integrity) throw missing();
      return JSON.stringify(integrity);
    }
    if (args[0] === "view" && args[2] === "dist-tags") {
      const record = records.get(args[1]);
      if (!record) throw missing();
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
      record.versions.set(candidate.version, candidate.integrity);
      record.tags.next = candidate.version;
      return JSON.stringify({ id: `${candidate.name}@${candidate.version}` });
    }
    if (args[0] === "dist-tag" && args[1] === "add") {
      const { name, version } = splitSpec(args[2]);
      const tag = args[3];
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
  };
}

function splitSpec(spec: string): { name: string; version: string } {
  const separator = spec.lastIndexOf("@");
  return { name: spec.slice(0, separator), version: spec.slice(separator + 1) };
}

function missing(): Error & { stderr: string } {
  return Object.assign(new Error("E404"), { stderr: "404 Not Found" });
}
