import { readFileSync } from "node:fs";
import path from "node:path";

const PORT_SOURCES = [
  ["packages/node-shared/tools/stella-browser-bridge-config.ts", /export const STELLA_BROWSER_BRIDGE_PORT = "(\d+)";/],
  ["packages/desktop/electron/services/stella-browser-bridge-namespace.ts", /const SHARED_EXTENSION_PORT = (\d+);/],
  ["packages/stella-browser/cli/src/native/extension_bridge.rs", /const DEFAULT_EXT_PORT: u16 = (\d+);/],
  ["packages/stella-browser/cli/src/native/native_host.rs", /const DEFAULT_PORT: u16 = (\d+);/],
  ["packages/stella-browser/extension/lib/connection.js", /const BRIDGE_HEALTH_URL = "http:\/\/127\.0\.0\.1:(\d+)\/healthz";/],
];

const HOST_NAME_SOURCES = [
  ["packages/node-shared/tools/stella-browser-bridge-config.ts", /export const STELLA_NATIVE_MESSAGING_HOST_NAME = "([^"]+)";/],
  ["packages/stella-browser/extension/lib/native-host-name.js", /export const STELLA_NATIVE_HOST_NAME = '([^']+)';/],
];

function collect(root, label, sources, problems) {
  const values = new Map();
  for (const [file, pattern] of sources) {
    const match = readFileSync(path.join(root, file), "utf8").match(pattern);
    if (!match) {
      problems.push(`${file}: ${label} declaration not found`);
      continue;
    }
    values.set(file, match[1]);
  }
  if (new Set(values.values()).size > 1) {
    problems.push(
      `${label} differs: ${[...values].map(([file, value]) => `${file}=${value}`).join(", ")}`,
    );
  }
}

export async function check(root) {
  const problems = [];
  collect(root, "browser bridge port", PORT_SOURCES, problems);
  collect(root, "native messaging host name", HOST_NAME_SOURCES, problems);
  return problems;
}
