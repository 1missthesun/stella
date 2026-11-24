import { readFileSync } from "node:fs";
import path from "node:path";

const MANIFEST = "packages/stella-browser/protocol/actions.json";
const PROTOCOL = "packages/runtime/kernel/browser-use/protocol.ts";
const CHAIN = "packages/runtime/kernel/browser-use/worker-api/chain.ts";

const quoted = (text) => [...text.matchAll(/"([^"]+)"/g)].map((match) => match[1]);

export async function check(root) {
  const read = (file) => readFileSync(path.join(root, file), "utf8");
  const manifest = JSON.parse(read(MANIFEST));
  const chainable = new Set(
    Object.entries(manifest.actions)
      .filter(([, action]) => action.chain === true)
      .map(([name]) => name),
  );
  const globalParams = new Set(manifest.globalParams.params);
  const problems = [];

  const protocolMatch = /BROWSER_CHAIN_ACTIONS = \[([\s\S]*?)\]/.exec(read(PROTOCOL));
  if (!protocolMatch) return [`${PROTOCOL}: BROWSER_CHAIN_ACTIONS array not found`];
  const declared = new Set(quoted(protocolMatch[1]));
  for (const name of declared) {
    if (!chainable.has(name)) problems.push(`${PROTOCOL}: BROWSER_CHAIN_ACTIONS has "${name}", which ${MANIFEST} does not mark "chain": true`);
  }
  for (const name of chainable) {
    if (!declared.has(name)) problems.push(`${PROTOCOL}: BROWSER_CHAIN_ACTIONS lacks "${name}", which ${MANIFEST} marks "chain": true`);
  }

  const chainMatch = /SAFE_ACTION_KEYS[^=]*=\s*Object\.freeze\(\{([\s\S]*?)\}\s*satisfies/.exec(read(CHAIN));
  if (!chainMatch) return [...problems, `${CHAIN}: SAFE_ACTION_KEYS object not found`];
  for (const entry of chainMatch[1].matchAll(/(\w+):\s*\[([\s\S]*?)\]/g)) {
    const [, action, keys] = entry;
    if (!chainable.has(action)) {
      problems.push(`${CHAIN}: SAFE_ACTION_KEYS offers "${action}", which ${MANIFEST} does not mark "chain": true`);
      continue;
    }
    const params = new Set(manifest.actions[action].params);
    for (const key of quoted(keys)) {
      if (!params.has(key) && !globalParams.has(key)) {
        problems.push(`${CHAIN}: SAFE_ACTION_KEYS.${action} has "${key}", which is not a ${MANIFEST} param of "${action}"`);
      }
    }
  }
  return problems;
}
