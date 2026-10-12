import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type { TailwindTools } from "./tools.js";

/**
 * Renderer stylesheets. A stylesheet that imports Tailwind is compiled with
 * Tailwind, scanning the app's sources for the classes it uses; every
 * stylesheet then has its relative `url()`s made absolute, because the
 * renderer injects them as `<style>` tags where relative URLs would resolve
 * against the page instead of the file.
 */

const TAILWIND_ENTRY = /@import\s+["']tailwindcss["']|@tailwind\s|@theme\b|@apply\b|@reference\b/;

export const isTailwindStylesheet = (source: string): boolean => TAILWIND_ENTRY.test(source);

const TAILWIND_CACHE_VERSION = "1";

/**
 * One Tailwind stylesheet, built incrementally the way Tailwind's own Vite
 * plugin does: the compiler and scanner live across builds, each build
 * rescans (the scanner rereads only what changed) and adds any new classes,
 * and only a change to the stylesheet or one of its imports starts over.
 * A cold build scans the whole UI (~250 ms); a warm one takes a few ms, so a
 * change's hot update doesn't wait on Tailwind.
 */
export const createTailwindBuild = (options: {
  loadTools: () => Promise<TailwindTools>;
  file: string;
  /** The project root Tailwind scans by default (Vite's root). */
  root: string;
  cacheDir?: string;
  warmDelayMs?: number;
}) => {
  type Compiler = Awaited<ReturnType<TailwindTools["compileTailwind"]>>;
  type Scanner = InstanceType<TailwindTools["TailwindScanner"]>;
  let state: {
    compiler: Compiler;
    scanner: Scanner;
    candidates: Set<string>;
    /** The stylesheet and its imports, with the mtime each was built from. */
    inputs: Map<string, number | null>;
  } | null = null;
  const mtime = (file: string) =>
    fs.promises.stat(file).then((stats) => stats.mtimeMs, () => null);
  const stale = async () => {
    if (!state) return true;
    for (const [file, built] of state.inputs) {
      if (built === null || (await mtime(file)) !== built) return true;
    }
    return false;
  };
  const inputs = new Set<string>();
  const cacheFile = options.cacheDir
    ? path.join(
        options.cacheDir,
        "tailwind",
        `${createHash("sha256").update(options.file).digest("hex").slice(0, 16)}.json`,
      )
    : null;
  const digest = (source: string) =>
    createHash("sha256").update(`${TAILWIND_CACHE_VERSION}\0${source}`).digest("hex");

  const compile = async (source: string): Promise<string> => {
    if (await stale()) {
      const tools = await options.loadTools();
      const files = [options.file];
      const compiler = await tools.compileTailwind(source, {
        base: path.dirname(options.file),
        from: options.file,
        shouldRewriteUrls: true,
        onDependency: (dependency) => files.push(path.resolve(dependency)),
      });
      const roots =
        compiler.root === "none"
          ? []
          : compiler.root === null
            ? [{ base: options.root, pattern: "**/*", negated: false }]
            : [{ ...compiler.root, negated: false }];
      state = {
        compiler,
        scanner: new tools.TailwindScanner({ sources: [...roots, ...compiler.sources] }),
        candidates: new Set(),
        inputs: new Map(await Promise.all(files.map(async (file) => [file, await mtime(file)] as const))),
      };
      inputs.clear();
      for (const file of files) inputs.add(file);
    }
    const current = state!;
    const startedAt = Date.now();
    for (const candidate of current.scanner.scan()) current.candidates.add(candidate);
    const css = current.compiler.build([...current.candidates]);
    if (cacheFile) void persist(current, source, css, startedAt).catch(() => undefined);
    return css;
  };

  const persist = async (
    current: NonNullable<typeof state>,
    source: string,
    css: string,
    startedAt: number,
  ) => {
    const dirs = new Set<string>();
    const walk = async (dir: string): Promise<void> => {
      dirs.add(dir);
      const entries = await fs.promises.readdir(dir, { withFileTypes: true }).catch(() => []);
      await Promise.all(
        entries
          .filter((entry) => entry.isDirectory() && !entry.name.startsWith(".") && entry.name !== "node_modules")
          .map((entry) => walk(path.join(dir, entry.name))),
      );
    };
    await Promise.all(
      current.scanner.globs.map((glob) => (glob.pattern.startsWith("**") ? walk(glob.base) : dirs.add(glob.base))),
    );
    const stamp = async (file: string): Promise<[string, number, number] | null> => {
      const stats = await fs.promises.stat(file).catch(() => null);
      return stats ? [file, stats.mtimeMs, stats.size] : null;
    };
    const files = await Promise.all(
      [...new Set([...current.inputs.keys(), ...current.scanner.files])].map(stamp),
    );
    const folders = await Promise.all([...dirs].map(stamp));
    if (files.some((entry) => !entry || entry[1] >= startedAt) || folders.some((entry) => !entry || entry[1] >= startedAt)) {
      return;
    }
    await fs.promises.mkdir(path.dirname(cacheFile!), { recursive: true });
    const temporary = `${cacheFile}.${process.pid}.${Math.random().toString(36).slice(2)}`;
    await fs.promises.writeFile(
      temporary,
      JSON.stringify({ digest: digest(source), files, dirs: folders, css }),
    );
    await fs.promises.rename(temporary, cacheFile!);
  };

  const cached = async (source: string): Promise<string | null> => {
    if (!cacheFile) return null;
    let entry: { digest: string; files: [string, number, number][]; dirs: [string, number, number][]; css: string };
    try {
      entry = JSON.parse(await fs.promises.readFile(cacheFile, "utf8"));
    } catch {
      return null;
    }
    if (entry.digest !== digest(source)) return null;
    const unchanged = async ([file, mtimeMs, size]: [string, number, number], isDir: boolean) => {
      const stats = await fs.promises.stat(file).catch(() => null);
      return Boolean(stats && stats.mtimeMs === mtimeMs && (isDir || stats.size === size));
    };
    const checks = await Promise.all([
      ...entry.files.map((stamp) => unchanged(stamp, false)),
      ...entry.dirs.map((stamp) => unchanged(stamp, true)),
    ]);
    return checks.every(Boolean) ? entry.css : null;
  };

  let queue: Promise<unknown> = Promise.resolve();
  const serially = <T>(task: () => Promise<T>): Promise<T> => {
    const run = queue.then(task, task);
    queue = run.catch(() => undefined);
    return run;
  };
  let warmTimer: ReturnType<typeof setTimeout> | null = null;

  return {
    /** The stylesheet and the files it imports (as of the last build). */
    inputs,
    build: (source: string): Promise<string> =>
      serially(async () => {
        if (!state) {
          const hit = await cached(source);
          if (hit !== null) {
            if (!warmTimer) {
              warmTimer = setTimeout(() => {
                void serially(async () => {
                  if (!state) await compile(source);
                }).catch(() => undefined);
              }, options.warmDelayMs ?? 3_000);
              warmTimer.unref?.();
            }
            return hit;
          }
        }
        return compile(source);
      }),
  };
};

export type TailwindBuild = ReturnType<typeof createTailwindBuild>;

const URL_REFERENCE = /url\(\s*(['"]?)([^'")]+)\1\s*\)/g;

/** Make relative `url()`s absolute against `baseUrl`, the stylesheet's own URL. */
export const absolutizeCssUrls = (css: string, baseUrl: string): string =>
  css.replace(URL_REFERENCE, (match, quote: string, reference: string) => {
    const trimmed = reference.trim();
    if (
      !trimmed ||
      trimmed.startsWith("#") ||
      trimmed.startsWith("/") ||
      /^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(trimmed)
    ) {
      return match;
    }
    try {
      return `url(${quote}${new URL(trimmed, baseUrl).pathname}${quote})`;
    } catch {
      return match;
    }
  });

/** A JS module that applies a stylesheet, as Vite's dev server served CSS imports. */
export const cssModule = (css: string, id: string): string =>
  [
    `const css = ${JSON.stringify(css)};`,
    `let style = document.querySelector(${JSON.stringify(`style[data-stella-css="${id}"]`)});`,
    `if (!style) {`,
    `  style = document.createElement("style");`,
    `  style.dataset.stellaCss = ${JSON.stringify(id)};`,
    `  document.head.appendChild(style);`,
    `}`,
    `style.textContent = css;`,
    `export default css;`,
  ].join("\n");
