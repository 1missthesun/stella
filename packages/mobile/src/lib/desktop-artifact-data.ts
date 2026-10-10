import { isCloudWorkspacePath } from "@stella/contracts/cloud-world-paths";
import {
  decodeUtf8,
  isDeviceNotFoundError,
  requestDevice,
} from "./device-requests";
import {
  isLinkedFileMissingError,
  linkedSourceIsFolder,
  readLinkedFileBytes,
  resolveLinkedFile,
  type LinkedFileSource,
} from "./linked-device-files";
import type { StoredPhoneAccess } from "./phone-access";

export { locateDeviceFile } from "./linked-device-files";

/**
 * Files and office previews that live on the owner's computers. The phone asks
 * the cloud, the cloud asks the computer that has the file over its presence
 * connection, and the bytes stream back through without being stored anywhere.
 * Each computer decides what may be read (Stella's own outputs and files from
 * the conversation); see `linked-device-files.ts` for how the computer is
 * found and `device-requests.ts` for the offline and refusal errors.
 */

export type DesktopFileReadResult =
  | {
      bytes: Uint8Array;
      sizeBytes: number;
      mimeType: string;
      missing: false;
    }
  | { missing: true; mimeType: string; path: string };

const OFFICE_PREVIEW_TIMEOUT_MS = 60_000;

const assertActive = (signal?: AbortSignal): void => {
  if (!signal?.aborted) return;
  const error = new Error("Artifact loading cancelled.");
  error.name = "AbortError";
  throw error;
};

/**
 * A cloud-world path asked of the computer is a routing mistake, not a missing
 * file. `/workspace/...` is the cloud sandbox; the paired computer has no such
 * tree, so it would answer "missing" — which the viewer renders as "this file
 * is no longer available". The file is not gone; it was asked of the wrong
 * machine. Drive files never get here: `stellaFileChatArtifact` routes them to
 * the owner-scoped drive URL first.
 */
export const assertReadableOnPairedComputer = (filePath: string): void => {
  if (!isCloudWorkspacePath(filePath)) return;
  throw new Error(
    "This file lives in Stella's cloud workspace, not on your computer, so it can't be opened from your phone. Ask Stella to put it in your Drive.",
  );
};

const MAX_IN_MEMORY_BYTES = 64 * 1024 * 1024;

const missingResult = (filePath: string): DesktopFileReadResult => ({
  missing: true,
  mimeType: "application/octet-stream",
  path: filePath,
});

// `async` so a refused path rejects rather than throwing synchronously: one
// caller chains `.then().catch()` straight off this inside an effect, where a
// synchronous throw would escape the catch and take the screen down.
export const readLinkedArtifactFile = async (
  access: StoredPhoneAccess | null,
  conversationId: string,
  filePath: string,
  signal?: AbortSignal,
  options?: { preferDeviceId?: string | null; maxBytes?: number },
): Promise<DesktopFileReadResult> => {
  assertReadableOnPairedComputer(filePath);
  assertActive(signal);
  let source: LinkedFileSource;
  try {
    source = await resolveLinkedFile(access, conversationId, filePath, {
      ...(signal ? { signal } : {}),
      preferDeviceId: options?.preferDeviceId ?? null,
    });
  } catch (error) {
    assertActive(signal);
    if (isLinkedFileMissingError(error)) return missingResult(filePath);
    throw error;
  }
  assertActive(signal);
  if (linkedSourceIsFolder(source)) {
    throw new Error("This is a folder, not a file.");
  }
  try {
    const { bytes, mimeType } = await readLinkedFileBytes(
      source,
      conversationId,
      filePath,
      {
        ...(signal ? { signal } : {}),
        maxBytes: options?.maxBytes ?? MAX_IN_MEMORY_BYTES,
      },
    );
    assertActive(signal);
    return { missing: false, bytes, sizeBytes: bytes.byteLength, mimeType };
  } catch (error) {
    assertActive(signal);
    if (isDeviceNotFoundError(error)) return missingResult(filePath);
    throw error;
  }
};

export const bytesToText = (bytes: Uint8Array): string => decodeUtf8(bytes);

const BASE64_CHARS =
  "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

const bytesToBase64 = (bytes: Uint8Array): string => {
  let output = "";
  for (let i = 0; i < bytes.length; i += 3) {
    const a = bytes[i] ?? 0;
    const b = bytes[i + 1] ?? 0;
    const c = bytes[i + 2] ?? 0;
    const triple = (a << 16) | (b << 8) | c;
    output += BASE64_CHARS[(triple >> 18) & 63];
    output += BASE64_CHARS[(triple >> 12) & 63];
    output += i + 1 < bytes.length ? BASE64_CHARS[(triple >> 6) & 63] : "=";
    output += i + 2 < bytes.length ? BASE64_CHARS[triple & 63] : "=";
  }
  return output;
};

export const bytesToDataUri = (bytes: Uint8Array, mimeType: string): string =>
  `data:${mimeType || "application/octet-stream"};base64,${bytesToBase64(bytes)}`;

const renderOfficePreview = async (
  access: StoredPhoneAccess,
  params: Record<string, unknown>,
  signal?: AbortSignal,
): Promise<string> => {
  assertActive(signal);
  const { bytes } = await requestDevice(access, "officePreview.render", params, {
    signal,
    timeoutMs: OFFICE_PREVIEW_TIMEOUT_MS,
  });
  assertActive(signal);
  return decodeUtf8(bytes);
};

export const loadOfficePreviewHtml = async (
  access: StoredPhoneAccess,
  conversationId: string,
  filePath: string,
  signal?: AbortSignal,
): Promise<string> => {
  assertReadableOnPairedComputer(filePath);
  return await renderOfficePreview(access, { filePath, conversationId }, signal);
};

export const loadExistingOfficePreviewHtml = (
  access: StoredPhoneAccess,
  conversationId: string,
  sessionId: string,
  signal?: AbortSignal,
): Promise<string> =>
  renderOfficePreview(access, { sessionId, conversationId }, signal);
