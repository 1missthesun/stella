import { promises as fs } from "node:fs";
import path from "node:path";
import { git, gitRaw, run } from "./git.js";
import { removeScratchDir } from "./dir-links.js";
import { copyEnvFiles, linkNodeModules } from "./update-gate.js";

/**
 * Merging a published version with the user's own changes before it is
 * offered, on a scratch worktree the running checkout never sees.
 *
 * Resolutions come first from git's own memory (rerere), trained from the
 * merges already in the user's history, so a conflict resolved once is never
 * paid for again. What is left goes to a model, one file at a time, only when
 * the caller allows it. A model that is not sure leaves the file unresolved:
 * that case goes to the user, never into a version. The merged tree must then
 * typecheck (renderer, runtime, main and preload) with no error the published
 * version doesn't have itself.
 */

export type ModelResolve = (request: { system: string; user: string }) => Promise<string>;

export type BackgroundMerge =
  | { ok: true; to: string; how: "rerere" | "model"; files: string[] }
  | {
      ok: false;
      unresolved: string[];
      reason: "conflicts" | "unsure" | "typecheck" | "failed";
      detail?: string;
    };

type Log = (event: string, data: Record<string, unknown>) => void;

const SCRATCH_CONFIG = [
  "-c",
  "rerere.enabled=true",
  "-c",
  "rerere.autoUpdate=true",
  "-c",
  "merge.conflictStyle=diff3",
  "-c",
  "core.hooksPath=/dev/null",
  "-c",
  "advice.detachedHead=false",
];
const TRAINED_FILE = "stella-rerere-trained";
const TRAIN_MERGES = 8;
const MAX_FILE_BYTES = 240_000;
const MAX_HUNKS = 40;
const MAX_DIFF_CHARS = 24_000;
const TYPECHECK_TIMEOUT_MS = 10 * 60_000;
const MODEL_TIMEOUT_MS = 8 * 60_000;
// Never incremental: build info would be written through the linked node_modules into the checkout.
const TYPECHECKS: string[][] = [
  ["-p", "packages/desktop-ui/tsconfig.app.json"],
  ["-p", "packages/desktop-ui/tsconfig.node.json"],
  ["-p", "packages/runtime/tsconfig.json"],
  ["-p", "packages/desktop/tsconfig.electron.json"],
  ["-p", "packages/desktop/tsconfig.preload.json"],
].map((project) => [...project, "--noEmit", "--incremental", "false"]);

const errorText = (error: unknown) => (error instanceof Error ? error.message : String(error));

type Scratch = {
  dir: string;
  g: (args: string[]) => Promise<string>;
  raw: (args: string[]) => ReturnType<typeof gitRaw>;
};

const openScratch = async (
  cwd: string,
  dir: string,
  head: string,
  env: NodeJS.ProcessEnv | undefined,
  signal?: AbortSignal,
): Promise<Scratch> => {
  // Links first: on Windows `git worktree remove` follows a junction and
  // would delete the app's own packages through it.
  await removeScratchDir(dir);
  await gitRaw(cwd, ["worktree", "prune"]);
  await fs.mkdir(path.dirname(dir), { recursive: true });
  await git(cwd, [...SCRATCH_CONFIG, "worktree", "add", "--detach", "--force", dir, head], {
    background: true,
    signal,
    timeoutMs: 5 * 60_000,
  });
  const options = { env, background: true, signal, timeoutMs: 5 * 60_000 };
  return {
    dir,
    g: (args) => git(dir, [...SCRATCH_CONFIG, ...args], options),
    raw: (args) => gitRaw(dir, [...SCRATCH_CONFIG, ...args], options),
  };
};

const closeScratch = async (cwd: string, dir: string) => {
  await removeScratchDir(dir).catch(() => undefined);
  await gitRaw(cwd, ["worktree", "prune"]).catch(() => undefined);
};

/** Teach rerere the resolutions in merges the user already has (what git's rerere-train does). */
const trainRerere = async (cwd: string, scratch: Scratch, head: string, log: Log) => {
  const common = await git(cwd, ["rev-parse", "--path-format=absolute", "--git-common-dir"]);
  const file = path.join(common, TRAINED_FILE);
  const trained = new Set(
    (await fs.readFile(file, "utf8").catch(() => "")).split("\n").filter(Boolean),
  );
  const merges = (await scratch.g(["rev-list", "--merges", `-n${TRAIN_MERGES}`, head]))
    .split("\n")
    .filter((sha) => sha && !trained.has(sha));
  let learned = 0;
  for (const merge of merges) {
    const parents = (await scratch.g(["rev-list", "--parents", "-n1", merge])).split(" ").slice(1);
    if (parents.length !== 2) {
      trained.add(merge);
      continue;
    }
    await scratch.raw(["checkout", "-q", "--detach", "-f", parents[0]!]);
    const merged = await scratch.raw(["merge", "--no-ff", "--no-commit", "-q", parents[1]!]);
    if (merged.code !== 0) {
      await scratch.raw(["rerere"]);
      await scratch.raw(["checkout", "-q", merge, "--", "."]);
      await scratch.raw(["rerere"]);
      learned += 1;
    }
    await scratch.raw(["merge", "--abort"]);
    await scratch.raw(["reset", "-q", "--hard"]);
    trained.add(merge);
  }
  await fs.writeFile(file, `${[...trained].slice(-200).join("\n")}\n`).catch(() => undefined);
  if (merges.length > 0) log("app-source.rerere-trained", { merges: merges.length, learned });
};

type Hunk = { start: number; end: number };

/** diff3 conflict blocks: `<<<<<<<` … `|||||||` … `=======` … `>>>>>>>`. */
const conflictHunks = (lines: string[]): Hunk[] | null => {
  const hunks: Hunk[] = [];
  let open: number | null = null;
  for (const [index, line] of lines.entries()) {
    if (line.startsWith("<<<<<<< ")) {
      if (open !== null) return null;
      open = index;
    } else if (line.startsWith(">>>>>>> ")) {
      if (open === null) return null;
      hunks.push({ start: open, end: index });
      open = null;
    }
  }
  return open === null ? hunks : null;
};

const clip = (text: string, limit: number) =>
  text.length <= limit ? text : `${text.slice(0, limit)}\n…(${text.length - limit} more characters)`;

const SYSTEM = `You resolve git merge conflicts in the source code of Stella, a desktop app (TypeScript, React, Electron) that its user has changed for themselves. "ours" is the user's own version; "theirs" is a newly published version of Stella; the block between ||||||| and ======= is what both started from.

Resolve each conflict so the result is the new version's code with the user's change carried onto it, and both work. Keep every intent of the user's change. Do not add anything neither side has.

Only resolve what you are confident about. If a conflict needs a judgement you cannot make from what you see (the two sides want incompatible things, or the user's change would have to be redesigned), do not guess: answer with "confident": false.

Answer with one JSON object and nothing else:
{"confident": true, "hunks": ["<text that replaces conflict 1, from its <<<<<<< line through its >>>>>>> line, without any markers>", "..."]}
or
{"confident": false, "why": "<one short sentence>"}`;

const resolveFile = async (args: {
  scratch: Scratch;
  file: string;
  base: string;
  head: string;
  tip: string;
  model: ModelResolve;
}): Promise<{ ok: true } | { ok: false; why: string }> => {
  const { scratch, file, base, head, tip, model } = args;
  const stages = new Set(
    (await scratch.g(["ls-files", "-u", "--", file]))
      .split("\n")
      .filter(Boolean)
      .map((line) => line.split(/\s+/)[2]),
  );
  if (!stages.has("1") || !stages.has("2") || !stages.has("3")) {
    return { ok: false, why: "added, deleted or renamed on one side" };
  }
  const absolute = path.join(scratch.dir, file);
  const buffer = await fs.readFile(absolute);
  if (buffer.length > MAX_FILE_BYTES || buffer.includes(0)) {
    return { ok: false, why: "too large or not text" };
  }
  const lines = buffer.toString("utf8").split("\n");
  const hunks = conflictHunks(lines);
  if (!hunks || hunks.length === 0 || hunks.length > MAX_HUNKS) {
    return { ok: false, why: "conflict markers it can't read" };
  }
  const numbered = lines.map((line, index) => {
    const at = hunks.findIndex((hunk) => hunk.start === index);
    return at >= 0 ? `<<<<<<< ours (conflict ${at + 1})` : line;
  });
  const [ours, theirs, subjects] = await Promise.all([
    scratch.raw(["diff", base, head, "--", file]),
    scratch.raw(["diff", base, tip, "--", file]),
    scratch.raw(["log", "--no-merges", "--format=- %s", "-n20", `${base}..${head}`]),
  ]);
  const user = `File: ${file}
Conflicts: ${hunks.length}

What the user's own changes were for (their commit subjects):
${subjects.stdout.trim() || "(none recorded)"}

The user's change to this file (merge base → ours):
\`\`\`diff
${clip(ours.stdout.trim(), MAX_DIFF_CHARS)}
\`\`\`

The published version's change to this file (merge base → theirs):
\`\`\`diff
${clip(theirs.stdout.trim(), MAX_DIFF_CHARS)}
\`\`\`

The file with its conflicts:
\`\`\`
${numbered.join("\n")}
\`\`\``;
  let answer: string;
  try {
    answer = await Promise.race([
      model({ system: SYSTEM, user }),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error("The model took too long.")), MODEL_TIMEOUT_MS).unref?.(),
      ),
    ]);
  } catch (error) {
    return { ok: false, why: errorText(error) };
  }
  const json = /\{[\s\S]*\}/.exec(answer.replace(/^```(?:json)?|```$/gm, ""))?.[0];
  let parsed: { confident?: unknown; hunks?: unknown; why?: unknown };
  try {
    parsed = JSON.parse(json ?? "") as typeof parsed;
  } catch {
    return { ok: false, why: "the model's answer was not readable" };
  }
  if (parsed.confident !== true) {
    return { ok: false, why: typeof parsed.why === "string" ? parsed.why : "not confident" };
  }
  const texts = parsed.hunks;
  if (
    !Array.isArray(texts) ||
    texts.length !== hunks.length ||
    texts.some((text) => typeof text !== "string")
  ) {
    return { ok: false, why: "the model's answer did not cover every conflict" };
  }
  const out: string[] = [];
  let cursor = 0;
  for (const [index, hunk] of hunks.entries()) {
    out.push(...lines.slice(cursor, hunk.start));
    const text = (texts[index] as string).replace(/\n$/, "");
    if (/^(<<<<<<<|\|\|\|\|\|\|\||=======|>>>>>>>)( |$)/m.test(text)) {
      return { ok: false, why: "the answer still had conflict markers" };
    }
    if (text !== "") out.push(...text.split("\n"));
    cursor = hunk.end + 1;
  }
  out.push(...lines.slice(cursor));
  await fs.writeFile(absolute, out.join("\n"));
  await scratch.g(["add", "--", file]);
  return { ok: true };
};

const TSC_ERROR = /^(.+?)\(\d+,\d+\): error (TS\d+): (.*)$/;

/** Each project's errors, without positions, so a version's own errors can be told from new ones. */
const typecheck = async (dir: string, signal?: AbortSignal) => {
  const errors = new Set<string>();
  const output: string[] = [];
  const tsc = path.join(dir, "node_modules", "typescript-7", "bin", "tsc");
  for (const project of TYPECHECKS) {
    const result = await run(process.execPath, [tsc, ...project, "--pretty", "false"], {
      cwd: dir,
      env: { ELECTRON_RUN_AS_NODE: "1" },
      timeoutMs: TYPECHECK_TIMEOUT_MS,
      background: true,
      signal,
    });
    if (result.code === 0) continue;
    const text = `${result.stdout}\n${result.stderr}`;
    let found = false;
    for (const line of text.split("\n")) {
      const match = TSC_ERROR.exec(line.trim());
      if (!match) continue;
      found = true;
      errors.add(`${match[1]}: ${match[2]}: ${match[3]}`);
      output.push(line.trim());
    }
    if (!found) {
      errors.add(`${project.join(" ")}: ${text.trim().slice(0, 400)}`);
      output.push(text.trim().slice(0, 400));
    }
  }
  return { errors, output };
};

export const mergeInBackground = async (args: {
  cwd: string;
  head: string;
  tip: string;
  subject: string;
  dir: string;
  identityEnv: NodeJS.ProcessEnv | undefined;
  model: ModelResolve | null;
  log: Log;
  signal?: AbortSignal;
}): Promise<BackgroundMerge> => {
  const { cwd, head, tip, subject, dir, identityEnv, model, log, signal } = args;
  const startedAt = Date.now();
  let scratch: Scratch | null = null;
  try {
    scratch = await openScratch(cwd, dir, head, identityEnv, signal);
    await trainRerere(cwd, scratch, head, log).catch((error: unknown) =>
      log("app-source.rerere-train-failed", { message: errorText(error) }),
    );
    await scratch.g(["checkout", "-q", "--detach", "-f", head]);
    const base = await scratch.g(["merge-base", head, tip]);
    await scratch.raw(["merge", "--no-ff", "--no-commit", "-q", tip]);
    await scratch.raw(["rerere"]);
    const remaining = (await scratch.g(["diff", "--name-only", "--diff-filter=U"]))
      .split("\n")
      .filter(Boolean);
    const unresolved: string[] = [];
    const reasons: string[] = [];
    if (remaining.length > 0 && !model) {
      log("app-source.merge-needs-model", { files: remaining.length });
      return { ok: false, unresolved: remaining, reason: "conflicts" };
    }
    for (const file of remaining) {
      const outcome = await resolveFile({ scratch, file, base, head, tip, model: model! });
      if (!outcome.ok) {
        unresolved.push(file);
        reasons.push(`${file}: ${outcome.why}`);
        continue;
      }
      // Remembered now, so a merge cut short never pays for this file again.
      await scratch.raw(["rerere"]);
    }
    if (unresolved.length > 0) {
      log("app-source.merge-unsure", { files: unresolved.length, reasons: reasons.join(" | ").slice(0, 2_000) });
      return { ok: false, unresolved, reason: "unsure", detail: reasons.join("\n") };
    }
    const resolved = (await scratch.g(["diff", "--cached", "--name-only", head])).split("\n").filter(Boolean);
    await scratch.g(["commit", "-q", "--no-verify", "-m", subject]);
    const to = await scratch.g(["rev-parse", "HEAD"]);
    await linkNodeModules(cwd, dir);
    await copyEnvFiles(cwd, dir);
    const merged = await typecheck(dir, signal);
    if (merged.errors.size > 0) {
      await scratch.g(["checkout", "-q", "--detach", "-f", tip]);
      const published = await typecheck(dir, signal);
      const added = [...merged.errors].filter((error) => !published.errors.has(error));
      if (added.length > 0) {
        log("app-source.merge-typecheck-failed", { errors: added.length, first: added[0]?.slice(0, 300) });
        return {
          ok: false,
          unresolved: remaining.length > 0 ? remaining : resolved,
          reason: "typecheck",
          detail: merged.output.slice(0, 40).join("\n"),
        };
      }
    }
    const how = remaining.length > 0 ? "model" : "rerere";
    log("app-source.merged-in-background", {
      tip: tip.slice(0, 12),
      how,
      files: remaining.length,
      ms: Date.now() - startedAt,
    });
    return { ok: true, to, how, files: remaining };
  } catch (error) {
    if (signal?.aborted) throw error;
    log("app-source.background-merge-failed", { message: errorText(error) });
    return { ok: false, unresolved: [], reason: "failed", detail: errorText(error) };
  } finally {
    await closeScratch(cwd, dir);
  }
};
