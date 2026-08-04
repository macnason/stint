#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { isIP } from "node:net";
import { resolve } from "node:path";

const root = resolve(argument("--root") ?? process.cwd());
const channel = argument("--channel") ?? "local";
if (!["local", "next", "latest"].includes(channel)) {
  fail([`unsupported release channel: ${channel}`]);
}

const errors = [];
const runtime = readJson("packages/stint/package.json", errors);
const cli = readJson("packages/stint-cli/package.json", errors);
const changesets = readJson(".changeset/config.json", errors);
const manifests = [runtime, cli];
const documentedVersion = readDocumentedVersion(errors);

if (runtime && cli) {
  if (runtime.version !== cli.version) errors.push("runtime and CLI versions must match");
  if (documentedVersion && documentedVersion !== runtime.version) {
    errors.push("release docs candidate version must match runtime and CLI versions");
  }
  for (const manifest of manifests) {
    if (!isCandidateVersion(manifest.version)) {
      errors.push(`${manifest.name}: version must match 1.0.0-next.N`);
    }
  }
  if (cli.dependencies?.[runtime.name] !== runtime.version) {
    errors.push("CLI dependency must exactly match the runtime name and version");
  }
  const fixed = changesets?.fixed;
  if (
    !Array.isArray(fixed) ||
    fixed.length !== 1 ||
    JSON.stringify(fixed[0]) !== JSON.stringify([runtime.name, cli.name])
  ) {
    errors.push("Changesets fixed group must exactly contain the runtime and CLI packages");
  }
}

const requiredGates = ["u7", "u11"];
const gates = {};
for (const gate of requiredGates) {
  gates[gate] = validateGate(gate, manifests, errors) ? "passed" : "failed";
}

if (channel !== "local") validateRemoteRelease(manifests, errors);
if (channel === "latest") validateLatestRelease(errors);

if (errors.length > 0) fail(errors);

console.log(
  JSON.stringify(
    {
      channel,
      publishable: channel !== "local",
      version: runtime.version,
      packages: manifests.map(({ name, version }) => ({ name, version })),
      gates,
    },
    null,
    2,
  ),
);

function validateGate(gate, expectedPackages, gateErrors) {
  const path = `.context/release-gates/${gate}.json`;
  let evidence;
  try {
    evidence = JSON.parse(readFileSync(resolve(root, path), "utf8"));
  } catch (error) {
    const reason = error?.code === "ENOENT" ? "is missing" : "is not valid JSON";
    gateErrors.push(`${gate} gate evidence ${reason}`);
    return false;
  }

  const expectedCommit =
    process.env.GITHUB_SHA ??
    tryCommand("git", ["rev-parse", "HEAD"]) ??
    "unknown";
  const expectedRunId = process.env.STINT_GATE_RUN_ID ?? "local";
  if (
    evidence.schemaVersion !== 1 ||
    evidence.gate !== gate ||
    evidence.status !== "passed"
  ) {
    gateErrors.push(`${gate} gate evidence does not record a passing ${gate} gate`);
    return false;
  }
  if (evidence.commit !== expectedCommit) {
    gateErrors.push(`${gate} gate evidence does not match the current commit`);
    return false;
  }
  if (evidence.runId !== expectedRunId) {
    gateErrors.push(`${gate} gate evidence does not match the current release run`);
    return false;
  }
  const packages = expectedPackages.map(({ name, version }) => ({ name, version }));
  if (JSON.stringify(evidence.packages) !== JSON.stringify(packages)) {
    gateErrors.push(`${gate} gate evidence does not match package versions`);
    return false;
  }
  return true;
}

function validateRemoteRelease(packages, remoteErrors) {
  for (const manifest of packages) {
    if (!manifest) continue;
    if (isPlaceholderName(manifest.name)) {
      remoteErrors.push(`${manifest.name}: placeholder package name cannot be published`);
    }
    if (manifest.private !== false) remoteErrors.push(`${manifest.name}: must not be private`);
    if (!manifest.license || manifest.license === "UNLICENSED") {
      remoteErrors.push(`${manifest.name}: license metadata is required`);
    }
    if (manifest.publishConfig?.access !== "public") {
      remoteErrors.push(`${manifest.name}: publishConfig.access must be public`);
    }
  }

  const owner = requiredEnvironment("STINT_NPM_OWNER", remoteErrors);
  const publisher = requiredEnvironment("STINT_TRUSTED_PUBLISHER", remoteErrors);
  const environment = requiredEnvironment("STINT_PROTECTED_ENVIRONMENT", remoteErrors);
  const repository = requiredEnvironment("GITHUB_REPOSITORY", remoteErrors);
  if (process.env.GITHUB_EVENT_NAME !== "workflow_dispatch") {
    remoteErrors.push("remote release requires workflow_dispatch");
  }
  if (process.env.GITHUB_REF_PROTECTED !== "true") {
    remoteErrors.push("remote release requires a protected ref");
  }
  if (environment && environment !== "stint-npm-release") {
    remoteErrors.push("STINT_PROTECTED_ENVIRONMENT must be stint-npm-release");
  }
  if (publisher && repository && environment) {
    const expected = `${repository}:.github/workflows/release.yml:${environment}`;
    if (publisher !== expected) {
      remoteErrors.push(`STINT_TRUSTED_PUBLISHER must equal ${expected}`);
    }
  }
  if (owner) validateNpmOwner(owner, packages, remoteErrors);
}

function validateLatestRelease(latestErrors) {
  const runtimeName = runtime?.name;
  const cliName = cli?.name;
  requiredNpmUrl("STINT_PUBLIC_RUNTIME_NPM_URL", runtimeName, latestErrors);
  requiredNpmUrl("STINT_PUBLIC_CLI_NPM_URL", cliName, latestErrors);
  requiredSourceUrl("STINT_PUBLIC_SOURCE_URL", latestErrors);
  requiredPublicUrl("STINT_PUBLIC_DOCS_URL", latestErrors);
  if (process.env.STINT_LATEST_APPROVED !== "true") {
    latestErrors.push("STINT_LATEST_APPROVED must be true");
  }
}

function requiredEnvironment(name, environmentErrors) {
  const value = process.env[name]?.trim();
  if (!value) environmentErrors.push(`${name} is required`);
  return value;
}

function requiredPublicUrl(name, urlErrors) {
  const value = requiredEnvironment(name, urlErrors);
  if (!value) return;
  try {
    const url = new URL(value);
    if (
      url.protocol !== "https:" ||
      url.username ||
      url.password ||
      url.port ||
      !isPublicHostname(url.hostname)
    ) {
      throw new Error("not public");
    }
  } catch {
    urlErrors.push(`${name} must be a public HTTPS URL`);
  }
}

function requiredNpmUrl(name, packageName, urlErrors) {
  const value = requiredEnvironment(name, urlErrors);
  if (!value || typeof packageName !== "string") return;
  try {
    const url = new URL(value);
    if (
      url.protocol !== "https:" ||
      url.hostname !== "www.npmjs.com" ||
      url.port ||
      url.username ||
      url.password ||
      url.search ||
      url.hash ||
      decodeURIComponent(url.pathname) !== `/package/${packageName}`
    ) {
      throw new Error("wrong npm package URL");
    }
  } catch {
    urlErrors.push(`${name} must be the public npm URL for ${packageName}`);
  }
}

function requiredSourceUrl(name, urlErrors) {
  const value = requiredEnvironment(name, urlErrors);
  const repository = process.env.GITHUB_REPOSITORY?.trim();
  if (!value || !repository) return;
  try {
    const url = new URL(value);
    if (
      url.protocol !== "https:" ||
      url.hostname !== "github.com" ||
      url.port ||
      url.username ||
      url.password ||
      url.search ||
      url.hash ||
      url.pathname.replace(/\/$/, "") !== `/${repository}`
    ) {
      throw new Error("wrong source repository URL");
    }
  } catch {
    urlErrors.push(`${name} must be the public GitHub URL for ${repository}`);
  }
}

function validateNpmOwner(owner, packages, ownerErrors) {
  const normalizedOwner = owner.replace(/^@/, "");
  const expectedPrefix = `@${normalizedOwner}/`;
  if (
    normalizedOwner.length === 0 ||
    packages.some((manifest) => !manifest?.name?.startsWith(expectedPrefix))
  ) {
    ownerErrors.push("STINT_NPM_OWNER must exactly match both package scopes");
  }
}

function isPublicHostname(hostname) {
  const normalized = hostname.toLowerCase().replace(/^\[|\]$/g, "").replace(/\.$/, "");
  const family = isIP(normalized);
  if (family === 4) return isPublicIpv4(normalized);
  if (family === 6) return isPublicIpv6(normalized);
  if (
    !normalized.includes(".") ||
    [
      "localhost",
      "local",
      "internal",
      "invalid",
      "test",
      "example",
      "onion",
      "home.arpa",
    ].some(
      (suffix) => normalized === suffix || normalized.endsWith(`.${suffix}`),
    )
  ) {
    return false;
  }
  return true;
}

function isPublicIpv4(address) {
  const [a, b, c] = address.split(".").map(Number);
  return !(
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 0 && c === 0) ||
    (a === 192 && b === 0 && c === 2) ||
    (a === 192 && b === 31 && c === 196) ||
    (a === 192 && b === 52 && c === 193) ||
    (a === 192 && b === 88 && c === 99) ||
    (a === 192 && b === 168) ||
    (a === 192 && b === 175 && c === 48) ||
    (a === 198 && (b === 18 || b === 19)) ||
    (a === 198 && b === 51 && c === 100) ||
    (a === 203 && b === 0 && c === 113) ||
    a >= 224
  );
}

function isPublicIpv6(address) {
  const normalized = address.toLowerCase();
  if (normalized === "::" || normalized === "::1") return false;
  if (normalized.startsWith("fc") || normalized.startsWith("fd")) return false;
  if (/^fe[89ab]/.test(normalized)) return false;
  if (normalized.startsWith("ff")) return false;
  if (normalized.startsWith("100:")) return false;
  if (normalized.startsWith("2001:db8:")) return false;
  const mapped = normalized.match(/::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  return mapped ? isPublicIpv4(mapped[1]) : true;
}

function isPlaceholderName(name) {
  return (
    typeof name !== "string" ||
    name.startsWith("@portfolio/") ||
    /(?:placeholder|temp)/i.test(name)
  );
}

function isCandidateVersion(version) {
  return typeof version === "string" && /^1\.0\.0-next\.\d+$/.test(version);
}

function readJson(relativePath, jsonErrors) {
  try {
    return JSON.parse(readFileSync(resolve(root, relativePath), "utf8"));
  } catch {
    jsonErrors.push(`${relativePath} is missing or invalid`);
    return undefined;
  }
}

function readDocumentedVersion(documentErrors) {
  try {
    const documentation = readFileSync(resolve(root, "docs/release/stint.md"), "utf8");
    const match = documentation.match(/^Candidate version: `([^`]+)`$/m);
    if (!match) throw new Error("missing marker");
    return match[1];
  } catch {
    documentErrors.push("docs/release/stint.md must declare Candidate version");
    return undefined;
  }
}

function tryCommand(command, args) {
  try {
    return execFileSync(command, args, { cwd: root, encoding: "utf8" }).trim();
  } catch {
    return undefined;
  }
}

function argument(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function fail(messages) {
  for (const message of messages) console.error(`release preflight: ${message}`);
  process.exit(1);
}
