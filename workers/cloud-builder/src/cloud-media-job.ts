import { sleepWithAbort } from "@stella/runtime/kernel/tools/effect-runtime.js";
import type { MediaGenerateAccepted, MediaJob } from "@stella/contracts/backend/media";
import { readBoundedResponseBytes } from "./bounded-body.js";
import { sha256Hex } from "./hash.js";
import { RpcError } from "./owner-store/errors.js";
import type { OwnerInternalCall } from "./owner-store/registry.js";
import type { DriveTurnFilesResult } from "./owner-store/domains/drive.js";

export type CloudMediaDriveFile = {
  path: string;
  name: string;
  sizeBytes: number;
  contentType: string;
};

export type CloudMediaToolContext = {
  ownerGeneration: string;
  conversationId: string;
  turnId: string;
  ownerInternal: OwnerInternalCall;
  publishFiles: (writerKey: string, files: CloudMediaDriveFile[]) => void | Promise<void>;
  downloadLinks?: boolean;
  fetchImpl?: typeof fetch;
  now?: () => number;
  sleep?: (ms: number, signal?: AbortSignal) => Promise<void>;
  timeoutMs?: number;
};

export type CloudMediaArtifact = {
  kind: "image" | "video";
  index: number;
  path: string;
  mimeType: string;
  sizeBytes: number;
};

export type CloudMediaFailure = {
  status: "failed" | "canceled" | "unknown";
  jobId?: string;
  prompt: string;
  error: { code: string; message: string; reason?: unknown };
  reattached: boolean;
};

export type CloudMediaToolResult = {
  content: Array<{ type: "text"; text: string }>;
  details: unknown;
  isError?: boolean;
};

const DEFAULT_JOB_TIMEOUT_MS = 10 * 60_000;
const ARTIFACT_GRACE_MS = 60_000;
const INITIAL_POLL_MS = 750;
const MAX_POLL_MS = 5_000;
const SUBMIT_ATTEMPTS = 3;

export const asNonEmptyString = (value: unknown): string | null =>
  typeof value === "string" && value.trim().length > 0 ? value.trim() : null;

const abortError = (signal: AbortSignal, noun: string): Error => {
  if (signal.reason instanceof Error) return signal.reason;
  const error = new Error(
    typeof signal.reason === "string" && signal.reason.trim()
      ? signal.reason
      : `${noun} generation was canceled.`,
  );
  error.name = "AbortError";
  return error;
};

export const throwIfAborted = (signal: AbortSignal | undefined, noun: string): void => {
  if (signal?.aborted) throw abortError(signal, noun);
};

export const withTimeout = (timeoutMs: number, signal?: AbortSignal): AbortSignal =>
  signal ? AbortSignal.any([signal, AbortSignal.timeout(timeoutMs)]) : AbortSignal.timeout(timeoutMs);

export const encodeBase64 = (bytes: Uint8Array): string => {
  let binary = "";
  const chunk = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += chunk) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunk));
  }
  return btoa(binary);
};

export const generatedDrivePath = (
  prefix: string,
  jobId: string,
  index: number,
  extension: string,
  now: number,
): string => `${prefix}/${new Date(now).toISOString().slice(0, 10)}/${jobId}_${index}.${extension}`;

export const downloadArtifact = async (args: {
  fetchImpl: typeof fetch;
  url: string;
  maxBytes: number;
  timeoutMs: number;
  noun: string;
  signal?: AbortSignal;
}): Promise<Uint8Array> => {
  const { fetchImpl } = args;
  const response = await fetchImpl(args.url, {
    signal: withTimeout(args.timeoutMs, args.signal),
    redirect: "follow",
  });
  if (!response.ok) throw new Error(`${args.noun} artifact download failed (${response.status}).`);
  return await readBoundedResponseBytes(response, args.maxBytes);
};

export const saveGeneratedFiles = async (args: {
  context: CloudMediaToolContext;
  source: string;
  toolCallId: string;
  kind: CloudMediaArtifact["kind"];
  files: Array<{ path: string; name: string; contentType: string; bytes: Uint8Array }>;
  inlineLimitBytes: number;
  noun: string;
  signal?: AbortSignal;
}): Promise<{ artifacts: CloudMediaArtifact[]; links: Array<{ path: string; url: string }> }> => {
  const { context } = args;
  const fetchImpl = context.fetchImpl ?? fetch;
  const staged = args.files.filter((file) => file.bytes.byteLength > args.inlineLimitBytes);
  const uploads = new Map<string, string>();
  if (staged.length > 0) {
    const stage = (await context.ownerInternal("drive.turnStage", {
      turnId: context.turnId,
      files: staged.map((file) => ({ path: file.path, sizeBytes: file.bytes.byteLength })),
    })) as {
      uploads: Array<{ path: string; uploadId: string; url: string }>;
      skipped: Array<{ path: string; reason: string }>;
    };
    for (const upload of stage.uploads) {
      const file = staged.find((entry) => entry.path === upload.path);
      if (!file) continue;
      throwIfAborted(args.signal, args.noun);
      const put = await fetchImpl(upload.url, {
        method: "PUT",
        body: file.bytes,
        headers: { "content-type": file.contentType },
        signal: withTimeout(120_000, args.signal),
      });
      if (!put.ok) throw new Error(`Saving the ${args.noun.toLowerCase()} to the drive failed (${put.status}).`);
      uploads.set(file.path, upload.uploadId);
    }
    if (uploads.size === 0 && stage.skipped[0]) throw new Error(stage.skipped[0].reason);
  }
  const report = args.files
    .filter((file) => file.bytes.byteLength <= args.inlineLimitBytes || uploads.has(file.path))
    .map((file) => ({
      path: file.path,
      name: file.name,
      sizeBytes: file.bytes.byteLength,
      contentType: file.contentType,
      ...(uploads.has(file.path)
        ? { uploadId: uploads.get(file.path) }
        : { contentBase64: encodeBase64(file.bytes) }),
    }));
  throwIfAborted(args.signal, args.noun);
  const payload = (await context.ownerInternal("drive.turnFiles", {
    turnId: context.turnId,
    hydratesDrive: false,
    source: args.source,
    batchKey: args.toolCallId,
    files: report,
  })) as DriveTurnFilesResult;
  const stored = new Set(payload.files.filter((file) => file.stored).map((file) => file.path));
  const artifacts: CloudMediaArtifact[] = [];
  const cardFiles: CloudMediaDriveFile[] = [];
  for (const [index, file] of report.entries()) {
    if (!stored.has(file.path)) continue;
    artifacts.push({ kind: args.kind, index, path: file.path, mimeType: file.contentType, sizeBytes: file.sizeBytes });
    cardFiles.push({ path: file.path, name: file.name, sizeBytes: file.sizeBytes, contentType: file.contentType });
  }
  if (artifacts.length === 0) {
    const reason = asNonEmptyString(payload?.skipped?.[0]?.reason);
    throw new Error(reason ?? `The drive did not accept the generated ${args.noun.toLowerCase()}.`);
  }
  await context.publishFiles(`${args.source}:${args.toolCallId}`, cardFiles);
  const links: Array<{ path: string; url: string }> = [];
  if (context.downloadLinks) {
    for (const artifact of artifacts) {
      const signed = (await context
        .ownerInternal("drive.fileUrl", { path: artifact.path })
        .catch(() => null)) as { url?: string } | null;
      if (signed?.url) links.push({ path: artifact.path, url: signed.url });
    }
  }
  return { artifacts, links };
};

export const savedFilesText = (
  noun: string,
  saved: { artifacts: CloudMediaArtifact[]; links: Array<{ path: string; url: string }> },
  agent: boolean,
): string => {
  const count = saved.artifacts.length;
  const listed = saved.artifacts.map((artifact) => artifact.path).join(", ");
  const head = `Generated ${count} ${noun.toLowerCase()}${count === 1 ? "" : "s"}: ${listed}.`;
  if (!agent) return head;
  const lines = [
    `${head} ${count === 1 ? "It is" : "They are"} in the user's drive (drive/${saved.artifacts[0]!.path}${count > 1 ? ", …" : ""}) and will be attached to your report automatically.`,
  ];
  if (saved.links.length > 0) {
    lines.push(
      "If you need the bytes in your workspace, download within the hour (the drive copy in your workspace may not be refreshed until your next run):",
      ...saved.links.map((link) => `- ${link.path}: ${link.url}`),
    );
  }
  return lines.join("\n");
};

export const runCloudMediaJob = async (args: {
  context: CloudMediaToolContext;
  noun: string;
  keyPrefix: string;
  keyNamespace: string;
  toolCallId: string;
  prompt: string;
  request: { model: string; input: Record<string, unknown> };
  signal?: AbortSignal;
  onUpdate?: (update: { content: Array<{ type: "text"; text: string }>; details: unknown }) => void;
  statusText: (status: MediaJob["status"]) => string;
  hasOutputs: (output: unknown) => boolean;
  materialize: (job: MediaJob, reattached: boolean) => Promise<CloudMediaToolResult>;
  existingJobId?: string | null;
  stillRunning?: (jobId: string) => string;
}): Promise<CloudMediaToolResult> => {
  const { context, noun, prompt, signal } = args;
  const now = context.now ?? Date.now;
  const sleep =
    context.sleep ?? ((ms: number, s?: AbortSignal) => sleepWithAbort(ms, s, (sig) => abortError(sig, noun)));
  const timeoutMs = context.timeoutMs ?? DEFAULT_JOB_TIMEOUT_MS;
  const clientRequestKey = `${args.keyPrefix}${await sha256Hex(
    [args.keyNamespace, context.ownerGeneration, context.conversationId, context.turnId, args.toolCallId].join("\0"),
  )}`;
  const deadline = now() + timeoutMs;
  let reattached = false;
  let lastSubmitError = "";

  const failure = (
    status: CloudMediaFailure["status"],
    code: string,
    message: string,
    extra: { jobId?: string; reason?: unknown } = {},
  ): CloudMediaToolResult => {
    const details: CloudMediaFailure = {
      status,
      ...(extra.jobId ? { jobId: extra.jobId } : {}),
      prompt,
      error: { code, message, ...(extra.reason !== undefined ? { reason: extra.reason } : {}) },
      reattached,
    };
    return { content: [{ type: "text", text: message }], details, isError: true };
  };

  const lookup = async (lookupArgs: { jobId?: string; clientRequestKey?: string }) =>
    (await context.ownerInternal("media.lookup", lookupArgs)) as MediaJob | null;

  let jobId: string | null = null;
  if (args.existingJobId) {
    const existing = await lookup({ jobId: args.existingJobId });
    if (!existing) return failure("failed", "job_lookup_not_found", `No ${noun.toLowerCase()} job ${args.existingJobId} exists.`);
    jobId = existing.jobId;
    reattached = true;
  }
  try {
    for (let attempt = 0; !jobId && attempt < SUBMIT_ATTEMPTS; attempt += 1) {
      throwIfAborted(signal, noun);
      try {
        const accepted = (await context.ownerInternal("media.generateForTurn", {
          request: { ...args.request, clientRequestKey },
          conversationId: context.conversationId,
          turnId: context.turnId,
        })) as MediaGenerateAccepted;
        jobId = accepted.jobId;
        if (accepted.reattached === true) reattached = true;
        break;
      } catch (error) {
        throwIfAborted(signal, noun);
        lastSubmitError = (error as Error).message;
        if (error instanceof RpcError && !error.retryable) {
          return failure("failed", `submission_${error.code.toLowerCase()}`, error.message);
        }
      }
      try {
        const existing = await lookup({ clientRequestKey });
        if (existing) {
          jobId = existing.jobId;
          reattached = true;
          break;
        }
      } catch {
      }
      await sleep(Math.min(250 * 2 ** attempt, 1_000), signal);
    }
    if (!jobId) {
      return failure(
        "unknown",
        "submission_outcome_unknown",
        `Stella could not confirm whether the ${noun.toLowerCase()} request was accepted. It will not submit a duplicate.`,
        lastSubmitError ? { reason: { cause: lastSubmitError } } : {},
      );
    }

    let pollMs = INITIAL_POLL_MS;
    let artifactDeadline: number | null = null;
    let lastJob: MediaJob | null = null;
    while (now() < deadline) {
      throwIfAborted(signal, noun);
      try {
        const value = await lookup({ jobId });
        if (!value) {
          return failure("failed", "job_lookup_not_found", `The ${noun.toLowerCase()} job no longer exists.`, { jobId });
        }
        lastJob = value;
        args.onUpdate?.({
          content: [{ type: "text", text: args.statusText(value.status) }],
          details: { jobId, status: value.status, statusText: args.statusText(value.status) },
        });
        if (value.status === "failed" || value.status === "canceled") {
          return failure(
            value.status,
            asNonEmptyString(value.error?.code)?.toLowerCase() ?? value.status,
            asNonEmptyString(value.error?.message) ?? `${noun} generation ${value.status}.`,
            { jobId, ...(value.error?.details !== undefined ? { reason: value.error.details } : {}) },
          );
        }
        if (value.status === "succeeded") {
          artifactDeadline ??= Math.min(deadline, now() + ARTIFACT_GRACE_MS);
          if (args.hasOutputs(value.output)) {
            try {
              return await args.materialize(value, reattached);
            } catch (error) {
              throwIfAborted(signal, noun);
              if (now() >= artifactDeadline) {
                return failure(
                  "failed",
                  "artifact_materialization_failed",
                  `${noun} completed but its artifact could not be saved: ${(error as Error).message}`,
                  { jobId },
                );
              }
            }
          } else if (now() >= artifactDeadline) {
            return failure(
              "failed",
              "artifact_missing",
              `${noun} generation completed without a downloadable artifact.`,
              { jobId },
            );
          }
        }
      } catch {
        throwIfAborted(signal, noun);
      }
      await sleep(Math.min(pollMs, Math.max(1, deadline - now())), signal);
      pollMs = Math.min(MAX_POLL_MS, Math.max(INITIAL_POLL_MS, pollMs * 1.5));
    }
    if (args.stillRunning && lastJob && (lastJob.status === "queued" || lastJob.status === "running")) {
      return {
        content: [{ type: "text", text: args.stillRunning(jobId) }],
        details: { status: "running", jobId, prompt, reattached },
      };
    }
    const timeoutMinutes = Math.max(1, Math.ceil(timeoutMs / 60_000));
    return failure(
      "unknown",
      "terminal_outcome_unknown",
      `${noun} generation still had no durable terminal outcome after ${timeoutMinutes} minute${timeoutMinutes === 1 ? "" : "s"}. Stella did not cancel or resubmit it.`,
      { jobId, ...(lastJob?.error ? { reason: lastJob.error } : {}) },
    );
  } catch (error) {
    if (signal?.aborted) {
      await context.ownerInternal("media.cancelForTurn", { clientRequestKey }).catch(() => undefined);
      throw abortError(signal, noun);
    }
    throw error;
  }
};
