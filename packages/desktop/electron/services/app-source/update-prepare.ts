import { promises as fs } from "node:fs";
import path from "node:path";
import { git, gitRaw } from "./git.js";
import {
  buildOnScratch,
  checkMergedUpdate,
  warmDependencies,
  type GateResult,
} from "./update-gate.js";
import { classifyUpdate, installs, relaunches, type UpdatePlan } from "./update-plan.js";

export type PrepareJob = {
  head: string;
  tip: string;
  ref: string;
  subject: string;
  trustIdenticalTree: boolean;
  identityEnv: () => Promise<NodeJS.ProcessEnv | undefined>;
};

export type PreparedUpdate = {
  head: string;
  tip: string;
  plan: Exclude<UpdatePlan, { kind: "none" }> | null;
  to: string | null;
  gate: GateResult | null;
  bundles: boolean;
  dir: string;
  ms: number;
};

type Log = (event: string, data: Record<string, unknown>) => void;

const RECORD = "record.json";

export const prepareKey = (head: string, tip: string) => `${head}:${tip}`;

const dirName = (head: string, tip: string) => `${head.slice(0, 20)}-${tip.slice(0, 20)}`;

export class UpdatePreparer {
  private readonly cwd: string;
  private readonly root: string;
  private readonly scratch: string;
  private readonly log: Log;
  private readonly onPrepared: () => void;
  private records = new Map<string, PreparedUpdate>();
  private loading: Promise<void> | null = null;
  private wanted: PrepareJob[] = [];
  private running: { key: string; abort: AbortController } | null = null;
  private paused = 0;

  constructor(options: {
    cwd: string;
    root: string;
    scratch: string;
    log: Log;
    onPrepared: () => void;
  }) {
    this.cwd = options.cwd;
    this.root = options.root;
    this.scratch = options.scratch;
    this.log = options.log;
    this.onPrepared = options.onPrepared;
  }

  private load() {
    this.loading ??= (async () => {
      await Promise.all(
        [this.scratch, `${this.scratch}.index`, `${this.scratch}-deps`].map((leftover) =>
          fs.rm(leftover, { recursive: true, force: true }).catch(() => undefined),
        ),
      );
      const names = await fs.readdir(this.root).catch(() => [] as string[]);
      for (const name of names) {
        const dir = path.join(this.root, name);
        try {
          const record = JSON.parse(
            await fs.readFile(path.join(dir, RECORD), "utf8"),
          ) as PreparedUpdate;
          if (record.dir !== dir) throw new Error("moved");
          this.records.set(prepareKey(record.head, record.tip), record);
        } catch {
          await fs.rm(dir, { recursive: true, force: true }).catch(() => undefined);
        }
      }
    })();
    return this.loading;
  }

  async isReady(head: string, tip: string) {
    await this.load();
    return this.records.has(prepareKey(head, tip));
  }

  async want(jobs: PrepareJob[]) {
    await this.load();
    const keys = new Set(jobs.map((job) => prepareKey(job.head, job.tip)));
    this.wanted = jobs;
    for (const [key, record] of this.records) {
      if (keys.has(key)) continue;
      this.records.delete(key);
      await fs.rm(record.dir, { recursive: true, force: true }).catch(() => undefined);
      this.log("app-source.prepare-dropped", { tip: record.tip.slice(0, 12) });
    }
    if (this.running && !keys.has(this.running.key)) this.running.abort.abort();
    this.next();
  }

  pause() {
    this.paused += 1;
    this.running?.abort.abort();
  }

  resume() {
    this.paused = Math.max(0, this.paused - 1);
    this.next();
  }

  async recordFor(head: string, tip: string): Promise<PreparedUpdate | null> {
    await this.load();
    const record = this.records.get(prepareKey(head, tip));
    if (!record?.plan || !record.to) return null;
    const exists = await gitRaw(this.cwd, ["cat-file", "-e", `${record.to}^{commit}`]);
    if (exists.code !== 0) return null;
    if (record.bundles && !(await fs.stat(path.join(record.dir, "dist-electron")).catch(() => null))) {
      return { ...record, bundles: false };
    }
    return record;
  }

  private next() {
    if (this.running || this.paused > 0) return;
    const job = this.wanted.find((candidate) => !this.records.has(prepareKey(candidate.head, candidate.tip)));
    if (!job) return;
    const key = prepareKey(job.head, job.tip);
    const abort = new AbortController();
    this.running = { key, abort };
    void this.prepare(job, abort.signal)
      .then(
        async (record) => {
          if (abort.signal.aborted || !this.wanted.some((w) => prepareKey(w.head, w.tip) === key)) {
            await fs.rm(record.dir, { recursive: true, force: true }).catch(() => undefined);
            return;
          }
          await fs
            .writeFile(path.join(record.dir, RECORD), JSON.stringify(record))
            .catch(() => undefined);
          this.records.set(key, record);
          this.onPrepared();
        },
        (error: unknown) => {
          if (!abort.signal.aborted) {
            this.log("app-source.prepare-failed", {
              message: error instanceof Error ? error.message : String(error),
            });
          }
        },
      )
      .finally(() => {
        if (this.running?.key === key) this.running = null;
        this.next();
      });
  }

  private async prepare(job: PrepareJob, signal: AbortSignal): Promise<PreparedUpdate> {
    const startedAt = Date.now();
    const cwd = this.cwd;
    const dir = path.join(this.root, dirName(job.head, job.tip));
    await fs.rm(dir, { recursive: true, force: true });
    await fs.mkdir(dir, { recursive: true });
    const options = { background: true, signal };
    const record = (fields: Partial<PreparedUpdate>): PreparedUpdate => ({
      head: job.head,
      tip: job.tip,
      plan: null,
      to: null,
      gate: null,
      bundles: false,
      dir,
      ms: Date.now() - startedAt,
      ...fields,
    });
    try {
      const plan = await classifyUpdate(cwd, job.head, job.ref);
      if (plan.kind === "none" || plan.tip !== job.tip) {
        throw new Error("The version changed while it was being prepared.");
      }
      if (plan.kind === "conflict") return record({ plan });
      const to =
        plan.kind === "fast-forward"
          ? plan.tip
          : await git(
              cwd,
              ["commit-tree", plan.tree, "-p", job.head, "-p", plan.tip, "-m", job.subject],
              { env: await job.identityEnv(), ...options },
            );
      const paths = (await git(cwd, ["diff", "--name-only", job.head, to], options))
        .split("\n")
        .filter(Boolean);
      const install = installs(paths);
      const keep = relaunches(paths) && !install ? dir : undefined;
      const checked = plan.kind === "clean" && !(job.trustIdenticalTree && plan.identical);
      let gate: GateResult | null = null;
      let bundles = false;
      if (checked) {
        gate = await checkMergedUpdate(cwd, to, this.scratch, this.log, { ...options, keep });
        bundles = Boolean(keep) && gate.ok;
      } else if (keep) {
        const built = await buildOnScratch({ cwd, commit: to, scratch: this.scratch, keep, ...options });
        bundles = built.ok;
      }
      if (install && (gate?.ok ?? true)) {
        await warmDependencies({
          cwd,
          from: job.head,
          to,
          scratch: `${this.scratch}-deps`,
          log: this.log,
          signal,
        });
      }
      if (signal.aborted) throw new Error("Stopped.");
      const done = record({ plan, to, gate, bundles });
      this.log("app-source.prepared", {
        tip: job.tip.slice(0, 12),
        kind: plan.kind,
        files: paths.length,
        gate: gate ? gate.ok : null,
        bundles,
        install,
        ms: done.ms,
      });
      return done;
    } catch (error) {
      if (signal.aborted) throw error;
      this.log("app-source.prepare-failed", {
        tip: job.tip.slice(0, 12),
        message: error instanceof Error ? error.message : String(error),
      });
      return record({});
    }
  }
}
