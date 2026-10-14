import { spawn, type ChildProcess } from "node:child_process";
import type { Readable } from "node:stream";
import path from "node:path";
import { existsSync } from "node:fs";
import { resolveNativeHelperPath } from "../native-helper-path.js";
import { getFileLogger } from "@stella/runtime/observability/file-logger";

type WakewordEvent =
  | {
      event: "ready";
      models: string[];
      sample_rate: number;
      channels: number;
      device_name: string;
    }
  | {
      event: "wake";
      model: string;
      score: number;
      threshold: number;
      timestamp_ms: number;
    };

type WakewordOptions = {
  threshold: number;
  modelPath?: string;
  predictStrideMs?: number;
  vadHangoverMs?: number;
  energyRmsThreshold?: number;
  energyPeakThreshold?: number;
  disableVad?: boolean;
  disableEnergyGate?: boolean;
  scoreSmoothing?: number;
  onWake: (event: Extract<WakewordEvent, { event: "wake" }>) => void;
  onReady?: (event: Extract<WakewordEvent, { event: "ready" }>) => void;
  onUnavailable?: (info: {
    reason: string;
    detail: Record<string, unknown>;
  }) => void;
};

const RESTART_BACKOFF_MS = 5000;
const MAX_CONSECUTIVE_START_FAILURES = 5;

// Windows refuses to start a process whose imports can't be resolved and
// reports it only as an exit status, with nothing on stderr. These are the
// codes a missing or mismatched DLL produces, so name them instead of leaving
// a bare number in the log.
const WINDOWS_LOAD_FAILURE_CODES = new Map<number, string>([
  [3221225781, "a DLL it needs is not installed (0xC0000135)"],
  [3221225785, "a DLL it needs is missing an entry point (0xC0000139)"],
]);

const resolveModelPath = (binaryPath: string): string | null => {
  const helperDir = path.dirname(binaryPath);
  const candidates = [
    path.join(helperDir, "wakeword_models", "hey_stella.onnx"),
    path.resolve(
      helperDir,
      "..",
      "..",
      "wakeword",
      "models",
      "hey_stella.onnx",
    ),
  ];
  for (const candidate of candidates) {
    if (existsSync(candidate)) return candidate;
  }
  return null;
};

export class WakewordService {
  private child: ChildProcess | null = null;
  private restartTimer: NodeJS.Timeout | null = null;
  private stdoutBuffer = "";
  private enabled = false;
  private paused = false;
  private disposed = false;
  private consecutiveStartFailures = 0;
  private unavailableReported = false;
  private lastStderrLine = "";

  constructor(private readonly options: WakewordOptions) {}

  setEnabled(enabled: boolean): void {
    if (this.enabled === enabled) return;
    this.enabled = enabled;
    if (enabled) {
      this.consecutiveStartFailures = 0;
      this.unavailableReported = false;
      this.spawnIfIdle();
    } else {
      this.stopChild();
    }
  }

  setPaused(paused: boolean): void {
    if (this.paused === paused) return;
    this.paused = paused;
    if (paused) {
      this.stopChild();
    } else if (this.enabled) {
      this.spawnIfIdle();
    }
  }

  dispose(): void {
    this.disposed = true;
    this.stopChild();
  }

  private spawnIfIdle(): void {
    if (this.disposed || !this.enabled || this.paused) return;
    if (this.child) return;
    if (this.restartTimer) return;

    const binaryPath = resolveNativeHelperPath("wakeword_listener");
    if (!binaryPath) {
      this.reportUnavailable("the listener binary was not found", {
        helper: "wakeword_listener",
      });
      return;
    }

    const modelPath = this.options.modelPath ?? resolveModelPath(binaryPath);
    if (!modelPath) {
      this.reportUnavailable("the hey_stella.onnx model was not found", {
        binaryPath,
      });
      return;
    }

    const args = [
      "start",
      "--model",
      modelPath,
      "--threshold",
      this.options.threshold.toString(),
    ];
    const o = this.options;
    if (o.predictStrideMs != null)
      args.push("--predict-stride-ms", String(o.predictStrideMs));
    if (o.vadHangoverMs != null)
      args.push("--vad-hangover-ms", String(o.vadHangoverMs));
    if (o.energyRmsThreshold != null)
      args.push("--energy-rms-threshold", String(o.energyRmsThreshold));
    if (o.energyPeakThreshold != null)
      args.push("--energy-peak-threshold", String(o.energyPeakThreshold));
    if (o.disableVad) args.push("--disable-vad");
    if (o.disableEnergyGate) args.push("--disable-energy-gate");

    let child: ChildProcess;
    try {
      // stdin stays open and unwritten: if this process dies without
      // stopping the listener, the pipe closes and the listener exits rather
      // than keeping the microphone open.
      child = spawn(binaryPath, args, {
        stdio: ["pipe", "pipe", "pipe"],
        windowsHide: true,
        env: {
          ...process.env,
          STELLA_EXIT_ON_STDIN_CLOSE: "1",
          ...(o.scoreSmoothing != null
            ? { WAKEWORD_SMOOTHING: String(o.scoreSmoothing) }
            : {}),
        },
      });
      child.stdin?.on("error", () => undefined);
    } catch (error) {
      this.noteStartFailure("the listener could not be spawned", {
        error: error instanceof Error ? error.message : String(error),
      });
      return;
    }

    this.child = child;
    this.stdoutBuffer = "";
    getFileLogger()?.process("native.wakeword.spawned", { pid: child.pid });

    const stdout = child.stdout as Readable | null;
    const stderr = child.stderr as Readable | null;
    if (!stdout || !stderr) {
      try {
        child.kill();
      } catch {
        // already gone
      }
      this.child = null;
      this.noteStartFailure("the listener spawned without stdio pipes");
      return;
    }
    stdout.setEncoding("utf8");
    stdout.on("data", (chunk: string) => this.handleStdout(chunk));
    stderr.setEncoding("utf8");
    stderr.on("data", (chunk: string) => {
      const line = chunk.trim();
      if (line) {
        this.lastStderrLine = line.split("\n").pop() ?? line;
        console.warn("[wakeword]", line);
      }
    });
    child.on("exit", (code, signal) => {
      if (this.child === child) {
        this.child = null;
      }
      if (this.disposed) return;
      if (code === 0 && signal === null) return;
      const detail = {
        code,
        signal,
        stderr: this.lastStderrLine || undefined,
      };
      const loadFailure =
        code != null ? WINDOWS_LOAD_FAILURE_CODES.get(code) : undefined;
      if (loadFailure) {
        this.reportUnavailable(
          `the listener could not start because ${loadFailure}`,
          detail,
        );
        return;
      }
      console.warn(
        `[wakeword] listener exited (code=${code} signal=${signal})`,
      );
      this.noteStartFailure("the listener keeps exiting", detail);
    });
    child.on("error", (error) => {
      console.warn("[wakeword] listener error:", error.message);
    });
  }

  private handleStdout(chunk: string): void {
    this.stdoutBuffer += chunk;
    let newlineIdx: number;
    while ((newlineIdx = this.stdoutBuffer.indexOf("\n")) !== -1) {
      const line = this.stdoutBuffer.slice(0, newlineIdx).trim();
      this.stdoutBuffer = this.stdoutBuffer.slice(newlineIdx + 1);
      if (!line) continue;
      let parsed: WakewordEvent;
      try {
        parsed = JSON.parse(line) as WakewordEvent;
      } catch {
        continue;
      }
      if (parsed.event === "ready") {
        this.consecutiveStartFailures = 0;
        this.options.onReady?.(parsed);
      } else if (parsed.event === "wake") {
        try {
          this.options.onWake(parsed);
        } catch (error) {
          console.warn("[wakeword] onWake handler threw:", error);
        }
      }
    }
  }

  private stopChild(): void {
    if (this.restartTimer) {
      clearTimeout(this.restartTimer);
      this.restartTimer = null;
    }
    const child = this.child;
    if (!child) return;
    this.child = null;
    getFileLogger()?.process("native.wakeword.stopped", {
      pid: child.pid,
      disposed: this.disposed,
    });
    try {
      child.kill();
    } catch {
      // Already dead — ignore.
    }
  }

  private noteStartFailure(
    reason: string,
    detail: Record<string, unknown> = {},
  ): void {
    this.consecutiveStartFailures += 1;
    const willRetry =
      this.consecutiveStartFailures < MAX_CONSECUTIVE_START_FAILURES;
    getFileLogger()?.warn("native.wakeword.start-failed", {
      ...detail,
      reason,
      consecutiveFailures: this.consecutiveStartFailures,
      willRetry,
    });
    if (!willRetry) {
      this.reportUnavailable(reason, {
        ...detail,
        consecutiveFailures: this.consecutiveStartFailures,
      });
      return;
    }
    this.scheduleRestart();
  }

  private reportUnavailable(
    reason: string,
    detail: Record<string, unknown> = {},
  ): void {
    if (this.unavailableReported) return;
    this.unavailableReported = true;
    if (this.restartTimer) {
      clearTimeout(this.restartTimer);
      this.restartTimer = null;
    }
    console.error(`[wakeword] wake word is unavailable: ${reason}.`);
    getFileLogger()?.error("native.wakeword.unavailable", {
      ...detail,
      reason,
    });
    try {
      this.options.onUnavailable?.({ reason, detail });
    } catch (error) {
      console.warn("[wakeword] onUnavailable handler threw:", error);
    }
  }

  private scheduleRestart(): void {
    if (this.disposed || !this.enabled || this.paused) return;
    if (this.restartTimer) return;
    this.restartTimer = setTimeout(() => {
      this.restartTimer = null;
      this.spawnIfIdle();
    }, RESTART_BACKOFF_MS);
  }
}
