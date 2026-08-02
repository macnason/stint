#!/usr/bin/env node

import { createHash } from "node:crypto";
import {
  copyFileSync,
  readFileSync,
  readdirSync,
  writeFileSync,
} from "node:fs";
import { basename, resolve } from "node:path";

const root = resolve(argument("--root") ?? process.cwd());
const directory = resolve(root, argument("--directory") ?? ".context/candidate");
const channel = requiredArgument("--channel");
if (!["next", "latest"].includes(channel)) fail(`unsupported channel: ${channel}`);

const definitions = [
  {
    role: "runtime",
    manifestPath: "packages/stint/package.json",
    packResultPath: requiredArgument("--runtime-pack"),
  },
  {
    role: "cli",
    manifestPath: "packages/stint-cli/package.json",
    packResultPath: requiredArgument("--cli-pack"),
  },
];

const packages = definitions.map(({ role, manifestPath, packResultPath }) => {
  const packageManifest = readJson(resolve(root, manifestPath));
  const packResults = readJson(resolve(root, packResultPath));
  const packResult = Array.isArray(packResults) ? packResults[0] : undefined;
  if (!packResult?.filename) fail(`${role} npm pack result is missing its filename`);
  const file = basename(packResult.filename);
  const bytes = readFileSync(resolve(directory, file));
  const integrity = `sha512-${createHash("sha512").update(bytes).digest("base64")}`;
  if (packResult.integrity && packResult.integrity !== integrity) {
    fail(`${role} npm pack integrity does not match the candidate bytes`);
  }
  return {
    role,
    name: packageManifest.name,
    version: packageManifest.version,
    file,
    sha256: createHash("sha256").update(bytes).digest("hex"),
    integrity,
  };
});

const helperFile = "stint-release.mjs";
copyFileSync(resolve(root, "scripts/stint-release.mjs"), resolve(directory, helperFile));

const manifestFile = "release-candidate.json";
writeFileSync(
  resolve(directory, manifestFile),
  `${JSON.stringify(
    {
      schemaVersion: 1,
      channel,
      commit: requiredEnvironment("GITHUB_SHA"),
      runId: requiredEnvironment("STINT_GATE_RUN_ID"),
      repository: requiredEnvironment("GITHUB_REPOSITORY"),
      packages,
    },
    null,
    2,
  )}\n`,
  { mode: 0o600 },
);

const checksumFiles = [manifestFile, helperFile, ...packages.map(({ file }) => file)].sort();
const checksums = checksumFiles.map((file) => {
  const digest = createHash("sha256").update(readFileSync(resolve(directory, file))).digest("hex");
  return `${digest}  ${file}`;
});
writeFileSync(resolve(directory, "release-candidate.sha256"), `${checksums.join("\n")}\n`, {
  mode: 0o600,
});

const unexpected = readdirSync(directory).filter(
  (file) => ![...checksumFiles, "release-candidate.sha256"].includes(file),
);
if (unexpected.length > 0) fail(`candidate contains unexpected files: ${unexpected.join(", ")}`);

function readJson(path) {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    fail(`${path} is missing or invalid JSON`);
  }
}

function argument(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function requiredArgument(name) {
  const value = argument(name);
  if (!value) fail(`${name} is required`);
  return value;
}

function requiredEnvironment(name) {
  const value = process.env[name]?.trim();
  if (!value) fail(`${name} is required`);
  return value;
}

function fail(message) {
  console.error(`prepare release candidate: ${message}`);
  process.exit(1);
}
