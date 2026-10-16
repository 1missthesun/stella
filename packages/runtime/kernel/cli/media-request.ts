import { fetchWithDeadline, REQUEST_BUDGET_MS } from "@stella/contracts/request-deadline";
import { readFile } from "node:fs/promises";
import path from "node:path";

export type MediaOperation =
  | { op: "models" }
  | { op: "generate"; request: string; idempotencyKey?: string }
  | { op: "job"; jobId: string };

export type MediaAuth = {
  baseUrl: string;
  authToken: string;
  deviceId?: string;
};

export type MediaHttpResult = { status: number; body: unknown };

const MAX_RESPONSE_BYTES = 4 * 1024 * 1024;

const MIME_TYPES: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  webp: "image/webp",
  gif: "image/gif",
  mp4: "video/mp4",
  mov: "video/quicktime",
  webm: "video/webm",
  mp3: "audio/mpeg",
  wav: "audio/wav",
  m4a: "audio/mp4",
  ogg: "audio/ogg",
  flac: "audio/flac",
};

export const inlineLocalFiles = async (value: unknown): Promise<unknown> => {
  if (typeof value === "string" && value.startsWith("file://")) {
    const filePath = new URL(value).pathname;
    const extension = path.extname(filePath).slice(1).toLowerCase();
    const mimeType = MIME_TYPES[extension] ?? "application/octet-stream";
    return `data:${mimeType};base64,${(await readFile(filePath)).toString("base64")}`;
  }
  if (Array.isArray(value)) return await Promise.all(value.map(inlineLocalFiles));
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, entry] of Object.entries(value)) {
      out[key] = await inlineLocalFiles(entry);
    }
    return out;
  }
  return value;
};

const mediaUrl = (baseUrl: string, pathname: string): URL =>
  new URL(pathname, baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`);

const readBody = async (response: Response): Promise<unknown> => {
  const text = await response.text().catch(() => "");
  if (text.length > MAX_RESPONSE_BYTES) {
    return { error: "The Stella media response was too large." };
  }
  if (!text) return null;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return { error: text };
  }
};

export const sendMediaRequest = async (
  auth: MediaAuth,
  operation: MediaOperation,
  signal?: AbortSignal,
): Promise<MediaHttpResult> => {
  const headers: Record<string, string> = {
    Authorization: `Bearer ${auth.authToken}`,
    ...(auth.deviceId ? { "X-Device-ID": auth.deviceId } : {}),
  };
  let url: URL;
  let init: RequestInit;
  switch (operation.op) {
    case "models":
      url = mediaUrl(auth.baseUrl, "/api/media/v1/models");
      init = { method: "GET", headers };
      break;
    case "job":
      url = mediaUrl(auth.baseUrl, "/api/media/v1/job");
      url.searchParams.set("jobId", operation.jobId);
      init = { method: "GET", headers };
      break;
    case "generate": {
      const body = await inlineLocalFiles(JSON.parse(operation.request) as unknown);
      url = mediaUrl(auth.baseUrl, "/api/media/v1/generate");
      init = {
        method: "POST",
        headers: {
          ...headers,
          "Content-Type": "application/json",
          ...(operation.idempotencyKey
            ? { "Idempotency-Key": operation.idempotencyKey }
            : {}),
        },
        body: JSON.stringify(body),
      };
      break;
    }
  }
  const response = await fetchWithDeadline(fetch, url.toString(), init, {
    label: `Stella media ${operation.op}`,
    timeoutMs: operation.op === "generate" ? REQUEST_BUDGET_MS.slow : REQUEST_BUDGET_MS.lookup,
    signal,
  });
  return { status: response.status, body: await readBody(response) };
};
