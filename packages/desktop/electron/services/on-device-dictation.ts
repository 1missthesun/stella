import { execFile, execFileSync, spawn, type ChildProcess } from "node:child_process";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import type {
  OnDeviceDictationStatus,
  OnDeviceDictationUnavailableReason,
  OnDeviceTranscript,
  TranscriptWord,
} from "@stella/contracts/desktop/ipc-contract";
import { resolveNativeHelperPath } from "../native-helper-path.js";

const HELPER = "speech_transcriber";
const PROBE_TIMEOUT_MS = 8_000;
const FINISH_TIMEOUT_MS = 30_000;
const STATUS_TTL_MS = 15_000;
const MACOS_26_DARWIN_MAJOR = 25;

type HelperEvent =
  | { type: "ready"; engine: string; locale: string }
  | { type: "partial"; text: string }
  | { type: "final"; text: string; words?: TranscriptWord[] }
  | { type: "error"; code: string; message: string }
  | { type: "installing"; locale: string };

type ProbeResult = {
  available: boolean;
  engine: "analyzer" | "sfspeech";
  locale: string | null;
  authorization: string;
  reason: string | null;
  locales: string[];
};

const usesSpeechAnalyzer = (): boolean =>
  Number.parseInt(os.release().split(".")[0] ?? "0", 10) >= MACOS_26_DARWIN_MAJOR;

let usageDescriptionPresent: boolean | null = null;

/**
 * Before macOS 26 the Speech Recognition prompt is charged to the app that is
 * responsible for the helper (Stella.app), and TCC kills a requester whose
 * responsible app has no NSSpeechRecognitionUsageDescription.
 */
const appHasSpeechUsageDescription = (): boolean => {
  if (usageDescriptionPresent !== null) return usageDescriptionPresent;
  const plist = path.resolve(path.dirname(process.execPath), "..", "Info.plist");
  try {
    const value = execFileSync(
      "/usr/bin/plutil",
      ["-extract", "NSSpeechRecognitionUsageDescription", "raw", "-o", "-", plist],
      { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] },
    );
    usageDescriptionPresent = value.trim().length > 0;
  } catch {
    usageDescriptionPresent = false;
  }
  return usageDescriptionPresent;
};

const localeArgs = (locales: readonly string[]): string[] =>
  locales.filter((locale) => /^[A-Za-z0-9-_]{2,24}$/.test(locale)).flatMap((locale) => ["--locale", locale]);

const parseLine = (line: string): HelperEvent | null => {
  try {
    const value = JSON.parse(line) as HelperEvent;
    return value && typeof value === "object" && typeof value.type === "string" ? value : null;
  } catch {
    return null;
  }
};

const normalizeReason = (reason: string | null | undefined): OnDeviceDictationUnavailableReason => {
  switch (reason) {
    case "unsupported":
    case "dictation-off":
    case "speech-denied":
    case "speech-restricted":
      return reason;
    default:
      return "failed";
  }
};

const runProbe = (helper: string, locales: readonly string[]): Promise<ProbeResult | null> =>
  new Promise((resolve) => {
    execFile(
      helper,
      ["probe", ...localeArgs(locales)],
      { timeout: PROBE_TIMEOUT_MS, maxBuffer: 256 * 1024 },
      (error, stdout) => {
        if (error) {
          resolve(null);
          return;
        }
        const line = stdout.trim().split("\n").pop() ?? "";
        try {
          resolve(JSON.parse(line) as ProbeResult);
        } catch {
          resolve(null);
        }
      },
    );
  });

type Session = {
  child: ChildProcess;
  owner: number;
  done: Promise<OnDeviceTranscript>;
  ready: Promise<void>;
};

type SpawnedHelper = {
  child: ChildProcess;
  done: Promise<OnDeviceTranscript>;
  /** Settles once the recognizer runs, after any permission prompt is answered. */
  ready: Promise<void>;
};

class TranscriptionFailure extends Error {
  constructor(
    message: string,
    readonly code: string,
  ) {
    super(message);
  }
}

export class OnDeviceDictation {
  private readonly sessions = new Map<string, Session>();
  private statusCache = new Map<string, { at: number; value: Promise<OnDeviceDictationStatus> }>();

  status(locales: readonly string[]): Promise<OnDeviceDictationStatus> {
    const key = locales.join(",");
    const cached = this.statusCache.get(key);
    if (cached && Date.now() - cached.at < STATUS_TTL_MS) return cached.value;
    const value = this.computeStatus(locales);
    this.statusCache.set(key, { at: Date.now(), value });
    return value;
  }

  invalidate(): void {
    this.statusCache.clear();
  }

  private async computeStatus(locales: readonly string[]): Promise<OnDeviceDictationStatus> {
    if (process.platform !== "darwin") return { available: false, reason: "platform", locales: [] };
    const helper = resolveNativeHelperPath(HELPER);
    if (!helper) return { available: false, reason: "missing-helper", locales: [] };
    const probe = await runProbe(helper, locales);
    if (!probe) return { available: false, reason: "failed", locales: [] };
    if (!probe.available || !probe.locale) {
      return { available: false, reason: normalizeReason(probe.reason), locales: probe.locales ?? [] };
    }
    if (probe.engine === "sfspeech" && !appHasSpeechUsageDescription()) {
      return { available: false, reason: "no-usage-description", locales: probe.locales ?? [] };
    }
    return { available: true, engine: probe.engine, locale: probe.locale, locales: probe.locales ?? [] };
  }

  private spawnHelper(args: string[]): SpawnedHelper {
    const helper = resolveNativeHelperPath(HELPER);
    if (!helper) throw new TranscriptionFailure("On-device dictation isn't installed.", "missing-helper");
    const prompt = usesSpeechAnalyzer() || appHasSpeechUsageDescription() ? ["--prompt"] : [];
    const child = spawn(helper, [...args, ...prompt], { stdio: ["pipe", "pipe", "ignore"] });
    let markReady: () => void = () => undefined;
    const ready = new Promise<void>((resolve) => {
      markReady = resolve;
    });
    const done = new Promise<OnDeviceTranscript>((resolve, reject) => {
      let buffered = "";
      let settled = false;
      const settle = (fn: () => void) => {
        if (settled) return;
        settled = true;
        fn();
      };
      child.stdout?.setEncoding("utf8");
      child.stdout?.on("data", (chunk: string) => {
        buffered += chunk;
        let newline = buffered.indexOf("\n");
        while (newline >= 0) {
          const event = parseLine(buffered.slice(0, newline));
          buffered = buffered.slice(newline + 1);
          newline = buffered.indexOf("\n");
          if (event?.type === "ready") {
            markReady();
          } else if (event?.type === "final") {
            settle(() => resolve({ text: event.text.trim(), words: event.words ?? [] }));
          } else if (event?.type === "error") {
            if (event.code.startsWith("speech-") || event.code === "dictation-off") this.invalidate();
            settle(() => reject(new TranscriptionFailure(event.message, event.code)));
          }
        }
      });
      child.on("error", (error) => settle(() => reject(error)));
      child.on("exit", (code, signal) =>
        settle(() =>
          reject(
            new TranscriptionFailure(
              signal ? "On-device dictation stopped." : `On-device dictation failed (${code}).`,
              "exited",
            ),
          ),
        ),
      );
    });
    child.stdin?.on("error", () => undefined);
    void done.catch(() => undefined).finally(markReady);
    return { child, done, ready };
  }

  start(owner: number, sessionId: string, locales: readonly string[]): void {
    this.cancel(sessionId);
    const { child, done, ready } = this.spawnHelper(["stream", ...localeArgs(locales)]);
    const session: Session = { child, owner, done, ready };
    this.sessions.set(sessionId, session);
    void done.finally(() => {
      if (this.sessions.get(sessionId) === session) this.sessions.delete(sessionId);
    }).catch(() => undefined);
  }

  push(owner: number, sessionId: string, pcm: ArrayBuffer | Uint8Array): void {
    const session = this.sessions.get(sessionId);
    if (!session || session.owner !== owner) return;
    const bytes = pcm instanceof Uint8Array ? pcm : new Uint8Array(pcm);
    if (bytes.byteLength === 0) return;
    session.child.stdin?.write(Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength));
  }

  async finish(owner: number, sessionId: string): Promise<OnDeviceTranscript> {
    const session = this.sessions.get(sessionId);
    if (!session || session.owner !== owner) {
      throw new TranscriptionFailure("Dictation ended before it was transcribed.", "missing-session");
    }
    session.child.stdin?.end();
    let timeout: ReturnType<typeof setTimeout> | undefined;
    void session.ready.then(() => {
      timeout = setTimeout(() => session.child.kill("SIGKILL"), FINISH_TIMEOUT_MS);
    });
    try {
      return await session.done;
    } finally {
      clearTimeout(timeout);
    }
  }

  cancel(sessionId: string): void {
    const session = this.sessions.get(sessionId);
    if (!session) return;
    this.sessions.delete(sessionId);
    session.child.kill("SIGKILL");
  }

  cancelOwnedBy(owner: number): void {
    for (const [id, session] of this.sessions) {
      if (session.owner === owner) this.cancel(id);
    }
  }

  async transcribeFile(audioPath: string, locales: readonly string[]): Promise<OnDeviceTranscript> {
    const { child, done, ready } = this.spawnHelper(["file", audioPath, ...localeArgs(locales)]);
    child.stdin?.end();
    let timeout: ReturnType<typeof setTimeout> | undefined;
    void ready.then(() => {
      timeout = setTimeout(() => child.kill("SIGKILL"), FINISH_TIMEOUT_MS * 4);
    });
    try {
      return await done;
    } finally {
      clearTimeout(timeout);
    }
  }

  async transcribeWav(wav: ArrayBuffer | Uint8Array, locales: readonly string[]): Promise<OnDeviceTranscript> {
    const file = path.join(os.tmpdir(), `stella-dictation-${randomUUID()}.wav`);
    const bytes = wav instanceof Uint8Array ? wav : new Uint8Array(wav);
    await fs.writeFile(file, bytes, { mode: 0o600 });
    try {
      return await this.transcribeFile(file, locales);
    } finally {
      await fs.rm(file, { force: true });
    }
  }

  dispose(): void {
    for (const id of [...this.sessions.keys()]) this.cancel(id);
  }
}

export const SYSTEM_DICTATION_SETTINGS_URL =
  "x-apple.systempreferences:com.apple.Keyboard-Settings.extension?Dictation";
