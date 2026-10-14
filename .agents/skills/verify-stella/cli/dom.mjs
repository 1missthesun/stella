import { buildSync } from "esbuild";
import { fileURLToPath } from "node:url";

const bundled = buildSync({
  entryPoints: [fileURLToPath(new URL("./dom-tools.page.mjs", import.meta.url))],
  bundle: true,
  write: false,
  format: "iife",
  globalName: "domToolsModule",
  platform: "browser",
  target: "es2022",
  charset: "ascii",
}).outputFiles[0].text;

export const DOM_TOOLS_JS = `(() => { ${bundled}; return domToolsModule.createDomTools(); })()`;

export function compareObservations(before, after) {
  const state = Object.fromEntries([...new Set([...Object.keys(before.state), ...Object.keys(after.state)])]
    .filter((key) => JSON.stringify(before.state[key]) !== JSON.stringify(after.state[key]))
    .map((key) => [key, { before: before.state[key], after: after.state[key] }]));
  const difference = (left, right) => {
    const remaining = right.map((item) => JSON.stringify(item));
    return left.filter((item) => {
      const index = remaining.indexOf(JSON.stringify(item));
      if (index < 0) return true;
      remaining.splice(index, 1);
      return false;
    });
  };
  return { state, ...(before.accessibility && after.accessibility ? { accessibilityChanged: JSON.stringify(before.accessibility) !== JSON.stringify(after.accessibility) } : {}), addedControls: difference(after.components, before.components), removedControls: difference(before.components, after.components) };
}
