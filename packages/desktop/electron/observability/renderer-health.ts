import { app, type WebContents } from "electron";
import { getMainLogger } from "./main-logger.js";

/**
 * Watches the main window's renderer from the main process so a hang, a
 * runaway, or a kill leaves a record of what the renderer was doing.
 *
 * Every SAMPLE_MS it:
 * - probes the renderer's main thread with a trivial script; the time until
 *   the answer comes back is how long a click or keypress would wait;
 * - reads the CPU and memory of the renderer and GPU processes.
 *
 * It logs (process log, written synchronously, so it survives SIGKILL):
 * - `main.renderer-stall` when a probe has been unanswered for STALL_MS, with
 *   the JavaScript stack the renderer is running when Chromium can give it,
 *   and `main.renderer-stall-ended` when it answers again;
 * - `main.renderer-busy` when the renderer has used most of a core for
 *   BUSY_AFTER_MS, and `main.renderer-busy-ended`;
 * - `main.renderer-health` every SUMMARY_MS: CPU, memory and probe latency
 *   over the period, so the minutes before a kill are on record;
 * - and gives `snapshot()` to whoever logs the renderer's exit.
 *
 * Cost: one empty script and one getAppMetrics call every two seconds.
 */

const SAMPLE_MS = 2_000;
const STALL_MS = 5_000;
const SLOW_PROBE_MS = 1_000;
const BUSY_CPU_PERCENT = 85;
const BUSY_AFTER_MS = 30_000;
const SUMMARY_MS = 5 * 60_000;
const STACK_TIMEOUT_MS = 2_000;
const HISTORY = 30;

type Sample = {
  at: number;
  cpu: number;
  memMb: number;
  gpuCpu: number;
  focused: boolean;
  visible: boolean;
};

const round = (value: number, digits = 0) => {
  const scale = 10 ** digits;
  return Math.round(value * scale) / scale;
};

const average = (values: number[]) =>
  values.length
    ? values.reduce((sum, value) => sum + value, 0) / values.length
    : 0;

export type RendererHealthSnapshot = Record<string, unknown>;

export class RendererHealthMonitor {
  private contents: WebContents | null = null;
  private pid = 0;
  private timer: NodeJS.Timeout | null = null;
  private samples: Sample[] = [];
  // cumulativeCPUUsage (CPU seconds) at the previous sample, per pid.
  // percentCPUUsage is divided by the core count on Linux, so a renderer
  // pegging one core reads ~3% on a 32-core machine; deltas don't lie.
  private cpuSeconds = new Map<number, { at: number; total: number }>();
  private probeSentAt = 0;
  private probeSeq = 0;
  private lastAnswerAt = 0;
  private lastProbeMs = 0;
  private stallLogged = false;
  private busySince = 0;
  private busyLogged = false;
  private summaryStartedAt = Date.now();
  private summaryProbeMax = 0;
  private summarySlowProbes = 0;
  private summaryStalls = 0;
  private summaryCpu: number[] = [];
  private summaryGpuCpu: number[] = [];
  private summaryMemMax = 0;

  constructor(
    private readonly describeWindow: () => {
      focused: boolean;
      visible: boolean;
    },
  ) {}

  attach(contents: WebContents) {
    if (this.contents === contents) return;
    this.detach();
    this.contents = contents;
    this.resetProbe();
    this.timer = setInterval(() => this.tick(), SAMPLE_MS);
    this.timer.unref?.();
    contents.once("destroyed", () => {
      if (this.contents === contents) this.detach();
    });
  }

  detach() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    this.contents = null;
  }

  /** A new renderer process took over (reload after a crash or kill). */
  resetProbe() {
    this.probeSeq += 1;
    this.probeSentAt = 0;
    this.lastAnswerAt = Date.now();
    this.stallLogged = false;
    this.busySince = 0;
    this.busyLogged = false;
    this.samples = [];
    this.pid = 0;
  }

  /** What the renderer looked like just before it went away. */
  snapshot(): RendererHealthSnapshot {
    const now = Date.now();
    const recent = this.samples.slice(-15);
    const last = this.samples[this.samples.length - 1];
    return {
      rendererPid: this.pid || undefined,
      probeUnansweredMs: this.probeSentAt ? now - this.probeSentAt : 0,
      lastAnswerAgoMs: this.lastAnswerAt ? now - this.lastAnswerAt : undefined,
      lastProbeMs: this.lastProbeMs,
      cpuLast30s: round(average(recent.map((sample) => sample.cpu))),
      cpuMaxLast30s: round(Math.max(0, ...recent.map((sample) => sample.cpu))),
      busyForMs: this.busySince ? now - this.busySince : 0,
      memMb: last ? round(last.memMb) : undefined,
      gpuCpuLast30s: round(average(recent.map((sample) => sample.gpuCpu))),
      focused: last?.focused,
      visible: last?.visible,
    };
  }

  private tick() {
    const contents = this.contents;
    if (!contents || contents.isDestroyed()) return;
    const now = Date.now();
    this.sampleMetrics(contents, now);
    this.probe(contents, now);
    this.checkBusy(now);
    if (now - this.summaryStartedAt >= SUMMARY_MS) this.logSummary(now);
  }

  private sampleMetrics(contents: WebContents, now: number) {
    let pid = 0;
    try {
      pid = contents.getOSProcessId();
    } catch {
      return;
    }
    if (pid && this.pid && pid !== this.pid) this.resetProbe();
    this.pid = pid;
    let cpu = 0,
      memMb = 0,
      gpuCpu = 0;
    try {
      const seen = new Map<number, { at: number; total: number }>();
      const percent = (metricPid: number, total: number | undefined) => {
        if (typeof total !== "number") return 0;
        const previous = this.cpuSeconds.get(metricPid);
        seen.set(metricPid, { at: now, total });
        if (!previous || now <= previous.at) return 0;
        return Math.max(0, ((total - previous.total) * 100_000) / (now - previous.at));
      };
      for (const metric of app.getAppMetrics()) {
        if (metric.pid === pid) {
          cpu = percent(metric.pid, metric.cpu.cumulativeCPUUsage);
          memMb = metric.memory.workingSetSize / 1024;
        } else if (metric.type === "GPU") {
          gpuCpu = percent(metric.pid, metric.cpu.cumulativeCPUUsage);
        }
      }
      this.cpuSeconds = seen;
    } catch {
      return;
    }
    const window = this.describeWindow();
    this.samples.push({ at: now, cpu, memMb, gpuCpu, ...window });
    if (this.samples.length > HISTORY) this.samples.shift();
    this.summaryCpu.push(cpu);
    this.summaryGpuCpu.push(gpuCpu);
    this.summaryMemMax = Math.max(this.summaryMemMax, memMb);
  }

  private probe(contents: WebContents, now: number) {
    if (this.probeSentAt) {
      const waited = now - this.probeSentAt;
      if (waited >= STALL_MS && !this.stallLogged) {
        this.stallLogged = true;
        this.summaryStalls += 1;
        void this.logStall(contents, waited);
      }
      return;
    }
    if (contents.isLoadingMainFrame() || contents.isCrashed()) return;
    const frame = contents.mainFrame;
    if (!frame) return;
    const seq = this.probeSeq;
    const sentAt = now;
    this.probeSentAt = sentAt;
    frame
      .executeJavaScript("0")
      .then(
        () => true,
        () => false,
      )
      .then((answered) => {
        if (seq !== this.probeSeq || this.probeSentAt !== sentAt) return;
        if (!answered) {
          // Navigation or teardown, not an answer; probe again next tick.
          this.probeSentAt = 0;
          return;
        }
        const answeredAt = Date.now();
        const took = answeredAt - sentAt;
        this.probeSentAt = 0;
        this.lastAnswerAt = answeredAt;
        this.lastProbeMs = took;
        this.summaryProbeMax = Math.max(this.summaryProbeMax, took);
        if (took >= SLOW_PROBE_MS) this.summarySlowProbes += 1;
        if (this.stallLogged) {
          this.stallLogged = false;
          getMainLogger()?.warn("main.renderer-stall-ended", {
            stalledMs: took,
            ...this.snapshot(),
          });
        }
      });
  }

  private async logStall(contents: WebContents, waited: number) {
    const logger = getMainLogger();
    logger?.error("main.renderer-stall", {
      unansweredMs: waited,
      ...this.snapshot(),
    });
    const stack = await collectStack(contents);
    if (stack) {
      logger?.error("main.renderer-stall-stack", {
        stack: stack.replace(/\s*\n\s*/g, " | ").slice(0, 4_000),
      });
    }
  }

  private checkBusy(now: number) {
    const last = this.samples[this.samples.length - 1];
    if (!last) return;
    if (last.cpu >= BUSY_CPU_PERCENT) {
      if (!this.busySince) this.busySince = now;
      if (!this.busyLogged && now - this.busySince >= BUSY_AFTER_MS) {
        this.busyLogged = true;
        getMainLogger()?.warn("main.renderer-busy", this.snapshot());
      }
      return;
    }
    if (this.busyLogged) {
      getMainLogger()?.warn("main.renderer-busy-ended", {
        busyForMs: now - this.busySince,
        cpu: round(last.cpu),
        focused: last.focused,
        visible: last.visible,
      });
    }
    this.busySince = 0;
    this.busyLogged = false;
  }

  private logSummary(now: number) {
    const last = this.samples[this.samples.length - 1];
    getMainLogger()?.process("main.renderer-health", {
      periodS: Math.round((now - this.summaryStartedAt) / 1000),
      rendererPid: this.pid || undefined,
      cpuAvg: round(average(this.summaryCpu)),
      cpuMax: round(Math.max(0, ...this.summaryCpu)),
      memMb: last ? round(last.memMb) : undefined,
      memMaxMb: round(this.summaryMemMax),
      gpuCpuAvg: round(average(this.summaryGpuCpu)),
      probeMaxMs: this.summaryProbeMax,
      slowProbes: this.summarySlowProbes,
      stalls: this.summaryStalls,
      focused: last?.focused,
      visible: last?.visible,
    });
    this.summaryStartedAt = now;
    this.summaryProbeMax = 0;
    this.summarySlowProbes = 0;
    this.summaryStalls = 0;
    this.summaryCpu = [];
    this.summaryGpuCpu = [];
    this.summaryMemMax = 0;
  }
}

/**
 * The JavaScript the renderer is running right now. Needs the page to be
 * served with `Document-Policy: include-js-call-stacks-in-crash-reports`
 * (the renderer protocol sends it); resolves to null when unavailable.
 */
const collectStack = async (contents: WebContents): Promise<string | null> => {
  const frame = contents.mainFrame as unknown as {
    collectJavaScriptCallStack?: () => Promise<string | void>;
  };
  if (typeof frame?.collectJavaScriptCallStack !== "function") return null;
  try {
    const stack = await Promise.race([
      frame.collectJavaScriptCallStack(),
      new Promise<null>((resolve) =>
        setTimeout(() => resolve(null), STACK_TIMEOUT_MS).unref?.(),
      ),
    ]);
    return typeof stack === "string" && stack.trim() ? stack : null;
  } catch {
    return null;
  }
};
