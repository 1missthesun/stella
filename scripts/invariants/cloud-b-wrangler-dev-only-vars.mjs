import { readFileSync } from "node:fs";
import path from "node:path";

const CONFIG = "workers/cloud-builder/wrangler.jsonc";

const DEV_ONLY_VARS = {
  EMAIL_FEATURE: ["production"],
  STELLA_TEST_ACCOUNTS: ["production", "bn118"],
};

const stripJsonc = (text) => {
  let out = "";
  let inString = false;
  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    const next = text[i + 1];
    if (inString) {
      out += char;
      if (char === "\\") {
        out += next;
        i += 1;
      } else if (char === '"') {
        inString = false;
      }
      continue;
    }
    if (char === '"') {
      inString = true;
      out += char;
    } else if (char === "/" && next === "/") {
      while (i < text.length && text[i] !== "\n") i += 1;
      out += "\n";
    } else if (char === "/" && next === "*") {
      i = text.indexOf("*/", i + 2) + 1;
    } else {
      out += char;
    }
  }
  return out.replace(/,(\s*[}\]])/g, "$1");
};

export async function check(root) {
  const config = JSON.parse(stripJsonc(readFileSync(path.join(root, CONFIG), "utf8")));
  const problems = [];
  for (const [name, envs] of Object.entries(DEV_ONLY_VARS)) {
    for (const env of envs) {
      const target = config.env?.[env];
      if (!target) {
        problems.push(`${CONFIG} has no "${env}" environment to check ${name} against`);
        continue;
      }
      if (name in (target.vars ?? {})) problems.push(`${CONFIG}: ${name} is dev-only and must not be set in env.${env}.vars`);
    }
  }
  return problems;
}
