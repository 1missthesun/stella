#!/usr/bin/env node
import { existsSync, readdirSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const root = path.resolve(import.meta.dirname, "..");
const dir = path.join(root, "scripts", "invariants");
const checks = (existsSync(dir) ? readdirSync(dir) : [])
  .filter((name) => name.endsWith(".mjs"))
  .sort();

const failures = [];
for (const name of checks) {
  const { check } = await import(pathToFileURL(path.join(dir, name)).href);
  if (typeof check !== "function") {
    failures.push(`${name}: exports no check(root) function`);
    continue;
  }
  const problems = await check(root);
  for (const problem of problems ?? []) failures.push(`${name}: ${problem}`);
}

if (failures.length > 0) {
  console.error(`Invariant violations:\n${failures.map((line) => `- ${line}`).join("\n")}`);
  process.exit(1);
}
console.log(`[invariants] ${checks.length} checks passed`);
