import { readFileSync } from "node:fs";
import path from "node:path";

const CONTRACT = "packages/contracts/canvas-host.ts";
const HEADERS = "packages/website/public/_headers";
const ROUTE = "/chat-app/canvas-host.html";
const WORKER = "packages/website/worker.mjs";

const stringsIn = (text) => [...text.matchAll(/"([^"\\]*)"|`([^`\\]*)`/g)].map((m) => m[1] ?? m[2]);

export async function check(root) {
  const source = readFileSync(path.join(root, CONTRACT), "utf8");
  const cdn = source.match(/export const CANVAS_CDN_SOURCES = \[([\s\S]*?)\]\.join\(" "\);/)?.[1];
  const directives = source.match(/canvasPolicyDirectives = [\s\S]*?return \[([\s\S]*?)\];/)?.[1];
  const sandbox = source.match(/export const CANVAS_FRAME_SANDBOX = "([^"]+)";/)?.[1];
  if (!cdn || !directives || !sandbox) return [`${CONTRACT}: canvas policy not found where this check reads it`];
  const unsafe = stringsIn(cdn).filter((source) => !/^https:\/\/[^*\s/]+$/.test(source));
  if (unsafe.length > 0) {
    return [`${CONTRACT}: CANVAS_CDN_SOURCES may list only https origins, never a wildcard or an app scheme (stella-media:, stella-app:): ${unsafe.join(", ")}`];
  }
  const sources = stringsIn(cdn).join(" ");
  const policy = stringsIn(directives).map((directive) =>
    directive.replaceAll("${self}", "").replaceAll("${CANVAS_CDN_SOURCES}", sources),
  );
  if (policy.some((directive) => directive.includes("${"))) return [`${CONTRACT}: canvas policy uses a value this check can't read`];
  const expected = `sandbox ${sandbox}; ${policy.join("; ")}; frame-ancestors 'self'`;

  const lines = readFileSync(path.join(root, HEADERS), "utf8").split("\n");
  const start = lines.indexOf(ROUTE);
  if (start === -1) return [`${HEADERS}: no ${ROUTE} rule`];
  const block = [];
  for (const line of lines.slice(start + 1)) {
    if (!/^\s/.test(line) || !line.trim()) break;
    block.push(line.trim());
  }
  const sent = block.find((line) => line.startsWith("Content-Security-Policy:"))?.slice("Content-Security-Policy:".length).trim();
  if (!block.includes("! Content-Security-Policy")) return [`${HEADERS}: ${ROUTE} must drop the chat's Content-Security-Policy`];
  if (sent !== expected) return [`${HEADERS}: ${ROUTE} Content-Security-Policy must be the canvas policy from ${CONTRACT}:\n  ${expected}`];
  // A user's own renderer's canvas host is proxied through the website worker, which sets its policy.
  const worker = readFileSync(path.join(root, WORKER), "utf8").match(/const CANVAS_HOST_POLICY =\s*"([^"]*)";/)?.[1];
  if (worker !== expected) return [`${WORKER}: CANVAS_HOST_POLICY must be the canvas policy from ${CONTRACT}:\n  ${expected}`];
  return [];
}
