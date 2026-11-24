import { readFileSync } from "node:fs";
import path from "node:path";

const CONTRACT = "packages/contracts/capabilities.ts";
const CLASSIFIER = "packages/desktop-ui/src/features/chat/streaming/stella-provider-error-classifier.ts";

export async function check(root) {
  const contract = readFileSync(path.join(root, CONTRACT), "utf8");
  const classifier = readFileSync(path.join(root, CLASSIFIER), "utf8");
  const problems = [];
  if (!/capabilityDenialMarker = \(capability: Capability\): string =>\s*`\[capability\/\$\{capability\}\]`/.test(contract)) {
    problems.push(`${CONTRACT}: capabilityDenialMarker must stay \`[capability/<id>]\`; ${CLASSIFIER} and older desktops parse it`);
  }
  if (!classifier.includes("/\\[capability\\/([a-z0-9_]+)\\]/")) {
    problems.push(`${CLASSIFIER}: must parse the \`[capability/<id>]\` marker capabilityDenialMarker writes`);
  }
  const ids = contract.match(/export const CAPABILITIES = \[([\s\S]*?)\] as const;/)?.[1];
  if (!ids) return [...problems, `${CONTRACT}: CAPABILITIES not found`];
  for (const [, id] of ids.matchAll(/"([^"]*)"/g)) {
    if (!/^[a-z0-9_]+$/.test(id)) problems.push(`${CONTRACT}: capability "${id}" can't be read back from its denial marker ([a-z0-9_]+)`);
  }
  return problems;
}
