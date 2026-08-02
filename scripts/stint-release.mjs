#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { pathToFileURL } from "node:url";

export async function releaseCandidate({ channel, manifestPath, runNpm = executeNpm }) {
  if (!["next", "latest"].includes(channel)) {
    throw new Error(`unsupported channel: ${channel}`);
  }
  const absoluteManifestPath = resolve(manifestPath);
  const directory = dirname(absoluteManifestPath);
  const manifest = JSON.parse(readFileSync(absoluteManifestPath, "utf8"));
  validateManifest(manifest, channel, directory);

  const snapshots = await snapshotTags(manifest.packages, runNpm);
  const changed = new Set();
  try {
    if (channel === "next") {
      await publishNext(manifest.packages, directory, changed, runNpm);
    } else {
      await promoteLatest(manifest.packages, directory, changed, runNpm);
    }
  } catch (error) {
    const restoreErrors = await restoreTags(
      manifest.packages,
      channel,
      snapshots,
      changed,
      runNpm,
    );
    if (restoreErrors.length > 0) {
      throw new AggregateError(
        [error, ...restoreErrors],
        `release failed and ${restoreErrors.length} tag restoration operation(s) failed`,
      );
    }
    throw error;
  }
}

async function publishNext(packages, directory, changed, runNpm) {
  const existing = new Map();
  for (const candidate of packages) {
    const integrity = await registryIntegrity(candidate, runNpm, true);
    if (integrity && integrity !== candidate.integrity) {
      throw new Error(`${candidate.name}@${candidate.version} exists with different bytes`);
    }
    existing.set(candidate.name, integrity !== undefined);
  }

  for (const candidate of packages) {
    if (!existing.get(candidate.name)) {
      changed.add(candidate.name);
      const output = await runNpm([
        "publish",
        "--provenance",
        "--access",
        "public",
        "--tag",
        "next",
        "--json",
        resolve(directory, candidate.file),
      ]);
      verifyPublishResult(output, candidate);
      const publishedIntegrity = await registryIntegrity(candidate, runNpm, false);
      if (publishedIntegrity !== candidate.integrity) {
        throw new Error(`${candidate.name}@${candidate.version} registry integrity mismatch`);
      }
    }
    changed.add(candidate.name);
    await runNpm(["dist-tag", "add", `${candidate.name}@${candidate.version}`, "next"]);
  }
}

async function promoteLatest(packages, directory, changed, runNpm) {
  for (const candidate of packages) {
    verifyCandidateBytes(candidate, directory);
    const integrity = await registryIntegrity(candidate, runNpm, false);
    if (integrity !== candidate.integrity) {
      throw new Error(`${candidate.name}@${candidate.version} next bytes do not match the verified candidate`);
    }
    const tags = await readTags(candidate.name, runNpm, false);
    if (tags.next !== candidate.version) {
      throw new Error(`${candidate.name} next tag does not reference ${candidate.version}`);
    }
  }
  for (const candidate of packages) {
    changed.add(candidate.name);
    await runNpm(["dist-tag", "add", `${candidate.name}@${candidate.version}`, "latest"]);
  }
}

async function snapshotTags(packages, runNpm) {
  const snapshots = new Map();
  for (const candidate of packages) {
    snapshots.set(candidate.name, await readTags(candidate.name, runNpm, true));
  }
  return snapshots;
}

async function restoreTags(packages, channel, snapshots, changed, runNpm) {
  const errors = [];
  for (const candidate of [...packages].reverse()) {
    if (!changed.has(candidate.name)) continue;
    const previous = snapshots.get(candidate.name)?.[channel];
    try {
      if (previous) {
        await runNpm(["dist-tag", "add", `${candidate.name}@${previous}`, channel]);
      } else {
        const current = await readTags(candidate.name, runNpm, true);
        if (current[channel]) await runNpm(["dist-tag", "rm", candidate.name, channel]);
      }
    } catch (error) {
      errors.push(
        new Error(`failed to restore ${candidate.name} ${channel}: ${error.message}`),
      );
    }
  }
  return errors;
}

async function registryIntegrity(candidate, runNpm, allowMissing) {
  try {
    const output = await runNpm([
      "view",
      `${candidate.name}@${candidate.version}`,
      "dist.integrity",
      "--json",
    ]);
    const value = JSON.parse(output);
    if (typeof value !== "string" || !value.startsWith("sha512-")) {
      throw new Error("registry returned invalid integrity");
    }
    return value;
  } catch (error) {
    if (allowMissing && isMissingPackage(error)) return undefined;
    throw error;
  }
}

async function readTags(name, runNpm, allowMissing) {
  try {
    const output = await runNpm(["view", name, "dist-tags", "--json"]);
    const value = JSON.parse(output);
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      throw new Error(`${name} returned invalid dist-tags`);
    }
    return value;
  } catch (error) {
    if (allowMissing && isMissingPackage(error)) return {};
    throw error;
  }
}

function validateManifest(manifest, channel, directory) {
  if (manifest.schemaVersion !== 1 || manifest.channel !== channel) {
    throw new Error("release manifest does not match the requested channel");
  }
  if (!Array.isArray(manifest.packages) || manifest.packages.length !== 2) {
    throw new Error("release manifest must contain exactly two packages");
  }
  if (
    new Set(manifest.packages.map(({ name }) => name)).size !== 2 ||
    JSON.stringify(manifest.packages.map(({ role }) => role)) !==
      JSON.stringify(["runtime", "cli"]) ||
    manifest.packages[0].version !== manifest.packages[1].version
  ) {
    throw new Error("release manifest package identities are inconsistent");
  }
  for (const candidate of manifest.packages) verifyCandidateBytes(candidate, directory);
}

function verifyCandidateBytes(candidate, directory) {
  if (!candidate?.name || !candidate?.version || !candidate?.file || !candidate?.integrity) {
    throw new Error("release manifest package entry is incomplete");
  }
  if (candidate.file !== candidate.file.split(/[\\/]/).at(-1)) {
    throw new Error("release manifest package filename must not escape the candidate directory");
  }
  const bytes = readFileSync(resolve(directory, candidate.file));
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  const integrity = `sha512-${createHash("sha512").update(bytes).digest("base64")}`;
  if (sha256 !== candidate.sha256 || integrity !== candidate.integrity) {
    throw new Error(`${candidate.name}@${candidate.version} candidate bytes do not match its manifest`);
  }
}

function verifyPublishResult(output, candidate) {
  const parsed = JSON.parse(output);
  const result = Array.isArray(parsed) ? parsed[0] : parsed;
  const expected = `${candidate.name}@${candidate.version}`;
  if (result?.id !== expected && `${result?.name}@${result?.version}` !== expected) {
    throw new Error(`npm publish result does not match ${expected}`);
  }
}

function isMissingPackage(error) {
  const output = `${error?.stderr ?? ""}\n${error?.message ?? ""}`;
  return /E404|404 Not Found|is not in this registry/i.test(output);
}

function executeNpm(args) {
  return execFileSync("npm", args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
}

async function main() {
  const channel = argument("--channel");
  const manifestPath = argument("--manifest") ?? "release-candidate.json";
  try {
    await releaseCandidate({ channel, manifestPath });
  } catch (error) {
    console.error(`stint release: ${error.message}`);
    process.exit(1);
  }
}

function argument(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) await main();
