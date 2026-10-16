import { File } from "expo-file-system";
import {
  REQUEST_BUDGET_MS,
  RequestTimeoutError,
  inactivitySignal,
  withDeadline,
  type DeadlineOptions,
} from "@stella/contracts/request-deadline";

const urlOf = (input: string | URL | Request): string =>
  typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;

/**
 * React Native's global fetch resolves only once the whole body has arrived, so
 * the deadline covers headers and body. Read bodies from the returned Response:
 * contracts `fetchWithDeadline` re-wraps bytes, which RN decodes as Latin-1.
 */
export const fetchWithinDeadline = async (
  input: string | URL | Request,
  init: RequestInit | undefined,
  options: DeadlineOptions,
): Promise<Response> =>
  await withDeadline(
    { ...options, signal: options.signal ?? init?.signal ?? null },
    async (signal) => await fetch(urlOf(input), { ...init, signal }),
  );

/** Fails once no bytes arrive for a minute, so large healthy downloads keep going. */
export const downloadFileWithinIdle = async (
  url: string,
  target: File,
  options: { label: string; signal?: AbortSignal },
): Promise<File> => {
  const idle = inactivitySignal({
    label: options.label,
    idleMs: REQUEST_BUDGET_MS.transferIdle,
    signal: options.signal,
  });
  try {
    return await File.downloadFileAsync(url, target, {
      idempotent: true,
      signal: idle.signal,
      onProgress: () => idle.touch(),
    });
  } catch (error) {
    if (idle.signal.aborted && !options.signal?.aborted) {
      throw new RequestTimeoutError(options.label, REQUEST_BUDGET_MS.transferIdle, "inactivity");
    }
    throw error;
  } finally {
    idle.dispose();
  }
};
