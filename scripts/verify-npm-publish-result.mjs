#!/usr/bin/env node

import { readFileSync } from "node:fs";

const [resultPath, expectedId] = process.argv.slice(2);
if (!resultPath || !expectedId) {
  fail("usage: verify-npm-publish-result.mjs <result.json> <expected-package@version>");
}

let result;
try {
  result = JSON.parse(readFileSync(resultPath, "utf8"));
} catch {
  fail("npm did not return valid publish JSON");
}
if (result.id !== expectedId) fail(`npm confirmed ${result.id ?? "no package"}, expected ${expectedId}`);

console.log(JSON.stringify(result, null, 2));

function fail(message) {
  console.error(`publish confirmation: ${message}`);
  process.exit(1);
}
