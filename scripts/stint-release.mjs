#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { pathToFileURL } from "node:url";

// registry.npmjs.org is read-after-write eventually consistent: publishes land on
// the origin, but packument GETs are served from a CDN that stamps
// `cache-control: public, max-age=300`. The pre-publish existence check below warms
// an edge with a packument that does not contain the new version, and that edge can
// keep serving it for up to five minutes after `npm publish` has already succeeded.
// Every read that has to observe our own write therefore polls instead of failing on
// the first miss. The budget deliberately exceeds the 300s max-age.
export const DEFAULT_VISIBILITY = {
  attempts: 14,
  initialDelayMs: 2000,
  maxDelayMs: 60000,
};

export async function releaseCandidate({
  channel,
  manifestPath,
  runNpm = executeNpm,
  visibility = DEFAULT_VISIBILITY,
  sleep = defaultSleep,
  log = (message) => console.error(`stint release: ${message}`),
}) {
  if (!["next", "latest"].includes(channel)) {
    throw new Error(`unsupported channel: ${channel}`);
  }
  const waitFor = createVisibilityWaiter({ visibility, sleep, log });
  const absoluteManifestPath = resolve(manifestPath);
  const directory = dirname(absoluteManifestPath);
  const manifest = JSON.parse(readFileSync(absoluteManifestPath, "utf8"));
  validateManifest(manifest, channel, directory);

  const snapshots = channel === "latest"
    ? await snapshotTags(manifest.packages, runNpm)
    : new Map();
  const changed = new Set();
  try {
    if (channel === "next") {
      await publishNext(manifest.packages, directory, runNpm, waitFor);
    } else {
      await promoteLatest(manifest.packages, directory, changed, runNpm, waitFor);
    }
  } catch (error) {
    if (channel === "next") throw error;
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

async function publishNext(packages, directory, runNpm, waitFor) {
  const existing = new Map();
  for (const candidate of packages) {
    // Not retried: a genuinely unpublished version must resolve immediately, and
    // this read is what establishes whether the publish below is still needed.
    const integrity = await registryIntegrity(candidate, runNpm, true);
    if (integrity && integrity !== candidate.integrity) {
      throw new Error(`${candidate.name}@${candidate.version} exists with different bytes`);
    }
    existing.set(candidate.name, integrity !== undefined);
  }

  for (const candidate of packages) {
    if (!existing.get(candidate.name)) {
      await runNpm([
        "publish",
        "--provenance",
        "--access",
        "public",
        "--tag",
        "next",
        "--json",
        resolve(directory, candidate.file),
      ]);
      await waitFor(`${candidate.name}@${candidate.version} to be readable`, async () => {
        const integrity = await registryIntegrity(candidate, runNpm, true);
        if (integrity === undefined) return pending("version is not visible yet");
        // Bytes that disagree are corruption, never propagation lag: fail now.
        if (integrity !== candidate.integrity) {
          throw new Error(`${candidate.name}@${candidate.version} registry integrity mismatch`);
        }
        return settled(integrity);
      });
    }
    // `npm publish --tag next` sets the tag as part of the same write, so any
    // disagreement here is a stale read of a write we already made. Wait it out.
    await waitFor(`${candidate.name} next tag to reference ${candidate.version}`, async () => {
      const tags = await readTags(candidate.name, runNpm, true);
      if (tags.next !== candidate.version) {
        return pending(`next tag still references ${tags.next ?? "nothing"}`);
      }
      return settled(tags.next);
    });
  }
}

async function promoteLatest(packages, directory, changed, runNpm, waitFor) {
  for (const candidate of packages) {
    verifyCandidateBytes(candidate, directory);
    const integrity = await waitFor(
      `${candidate.name}@${candidate.version} to be readable`,
      async () => {
        const value = await registryIntegrity(candidate, runNpm, true);
        return value === undefined ? pending("version is not visible yet") : settled(value);
      },
    );
    if (integrity !== candidate.integrity) {
      throw new Error(`${candidate.name}@${candidate.version} next bytes do not match the verified candidate`);
    }
    // Unlike the publish path this validates pre-existing state rather than our own
    // write, so a tag that resolves to a different version is an error, not lag.
    const tags = await waitFor(`${candidate.name} dist-tags to be readable`, async () => {
      const value = await readTags(candidate.name, runNpm, true);
      return value.next === undefined ? pending("dist-tags are not visible yet") : settled(value);
    });
    if (tags.next !== candidate.version) {
      throw new Error(`${candidate.name} next tag does not reference ${candidate.version}`);
    }
  }
  for (const candidate of packages) {
    try {
      await runNpm(["dist-tag", "add", `${candidate.name}@${candidate.version}`, "latest"]);
    } catch (error) {
      throw isUnauthorized(error) ? unauthorizedPromotion(candidate, error) : error;
    }
    // Recorded only after the write lands. Marking it beforehand made a failed
    // first promotion roll back a tag that was never touched, which turned one
    // clear error into an AggregateError about failed restoration.
    changed.add(candidate.name);
  }
}

// Trusted publishing performs its OIDC exchange inside `npm publish`; a separate
// `npm dist-tag` process does not inherit that credential and gets a 401. This is
// expected in CI and is not a misconfiguration to be fixed with a stored token —
// see docs/release/stint.md. Promotion is a maintainer action.
function unauthorizedPromotion(candidate, error) {
  return new Error(
    [
      `cannot promote ${candidate.name}@${candidate.version} to latest: npm rejected the`,
      "dist-tag write as unauthorized. Trusted publishing authenticates `npm publish`",
      "only, so this workflow cannot move dist-tags and no npm token is stored in CI",
      "by policy. Every promotion gate above has already passed and the candidate bytes",
      "are verified, so a maintainer can complete the promotion locally:",
      "",
      `  npm dist-tag add ${candidate.name}@${candidate.version} latest`,
      "",
      "See docs/release/stint.md ('Promoting `latest`') for the full runbook.",
      `Underlying npm error: ${error.message}`,
    ].join("\n"),
  );
}

function isUnauthorized(error) {
  const output = `${error?.stderr ?? ""}\n${error?.message ?? ""}`;
  return /E401|401 Unauthorized/i.test(output);
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

function settled(value) {
  return { done: true, value };
}

function pending(reason) {
  return { done: false, reason };
}

// Polls `read` until it reports settled. `read` signals "not yet consistent" by
// returning pending(); anything it throws is treated as a real fault and aborts
// immediately, so genuine failures still fail fast.
function createVisibilityWaiter({ visibility, sleep, log }) {
  const { attempts, initialDelayMs, maxDelayMs } = visibility;
  return async function waitFor(description, read) {
    let delay = initialDelayMs;
    let reason = "no attempt was made";
    for (let attempt = 1; attempt <= attempts; attempt += 1) {
      const outcome = await read();
      if (outcome.done) return outcome.value;
      reason = outcome.reason;
      if (attempt === attempts) break;
      log(`waiting for ${description} (${reason}); retry ${attempt}/${attempts - 1} in ${delay}ms`);
      await sleep(delay);
      delay = Math.min(delay * 2, maxDelayMs);
    }
    throw new Error(
      `timed out after ${attempts} attempts waiting for ${description}: ${reason}`,
    );
  };
}

function defaultSleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
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
    console.error(`stint release: ${formatReleaseError(error)}`);
    process.exit(1);
  }
}

function formatReleaseError(error) {
  if (error instanceof AggregateError) {
    const causes = [...error.errors].map((cause) => cause?.message ?? String(cause));
    return `${error.message}\n${causes.map((cause) => `- ${cause}`).join("\n")}`;
  }
  return error?.message ?? String(error);
}

function argument(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) await main();
