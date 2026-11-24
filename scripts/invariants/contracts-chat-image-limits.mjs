import { readFileSync } from "node:fs";
import path from "node:path";

const CLIENT = "packages/contracts/chat-image-limits.ts";
const CLOUD = "packages/runtime/kernel/shared/image-caps.ts";

const number = (text, pattern) => {
  const raw = text.match(pattern)?.[1];
  if (!raw || !/^[\d_.\s*()+]+$|^Math\.floor\([\d_.\s*()+]+\)$/.test(raw)) return undefined;
  return Function(`"use strict"; return (${raw.replaceAll("_", "")});`)();
};

export async function check(root) {
  const client = readFileSync(path.join(root, CLIENT), "utf8");
  const cloud = readFileSync(path.join(root, CLOUD), "utf8");
  const clientEdge = number(client, /export const CHAT_IMAGE_MAX_EDGE = ([^;]+);/);
  const clientBytes = number(client, /export const CHAT_IMAGE_MAX_BYTES = ([^;]+);/);
  const cloudEdge = number(cloud, /export const CONTEXT_IMAGE_MAX_EDGE = ([^;]+);/);
  const cloudBytes = number(cloud, /export const DURABLE_OBJECT_READ_IMAGE_CAPS: ImageCaps = \{[^}]*?maxBytes: ([^,\n]+),/);
  if ([clientEdge, clientBytes, cloudEdge, cloudBytes].some((value) => typeof value !== "number" || !Number.isFinite(value))) {
    return [`${CLIENT} / ${CLOUD}: image limits not found where this check reads them`];
  }
  const problems = [];
  if (clientEdge > cloudEdge) problems.push(`${CLIENT}: CHAT_IMAGE_MAX_EDGE ${clientEdge} exceeds the cloud's fit (${CLOUD} CONTEXT_IMAGE_MAX_EDGE ${cloudEdge}), so uploads get re-encoded`);
  if (clientBytes >= cloudBytes) problems.push(`${CLIENT}: CHAT_IMAGE_MAX_BYTES ${clientBytes} must stay under the cloud's fit (${CLOUD} DURABLE_OBJECT_READ_IMAGE_CAPS.maxBytes ${cloudBytes})`);
  return problems;
}
