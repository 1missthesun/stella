// The UI as separate modules (ui-registry.ts runs them): one Bun build over the whole graph finds
// every module and what each import resolves to, then each source module the host doesn't already
// have is built on its own as a CommonJS factory whose imports all stay external, as tagged ids
// the registry resolves (`\0m:` a source module, `\0i:` one imported with `import()`, `\0d:`/`\0r:`
// a package from the deps bundle by import/require, `\0x:` a host module such as react). Packages
// are one deps bundle, rebuilt only when the set of package entries changes.

import { readdirSync, statSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { viteCompat } from "../vite-compat";
import { uiBuildMode } from "./ui-mode";
import { declaredExports, DEPS_KEY, HELPERS_KEY, type HelpersInfo, MODULES_LINES, type DepsInfo, type ImportTag, type ModuleNode, type ModulesBuild, type ModulesLines, type ModulesRequest } from "./ui-modules-format";

export type UiBuildSpec = { entry: string; tsconfig: string; external: string[] };


/** A factory's top-level declarations of what may be a component (`function Foo(`, `var Foo =`). */
const TOP_LEVEL_COMPONENT = /^(?:function\*? |(?:var|let|const) )([A-Z][\w$]*)\b/gm;
const JSX_TYPE = /\b(jsxDEV|jsxs|jsx|createElement)(\)?)\(([A-Z][\w$]*)(\s*,)/g;

const isPackage = (file: string) => file.includes(`${path.sep}node_modules${path.sep}`);
const JS = /\.(m?[jt]sx?|cjs)$/;

type Edge = { path: string; external: boolean; kind: string };
type Meta = { inputs: Record<string, { format?: string; imports: Array<{ path: string; kind: string; original?: string; external?: boolean }> }> };

const options = (spec: UiBuildSpec) => ({
  target: "bun",
  format: "cjs",
  tsconfig: spec.tsconfig,
  jsx: { development: uiBuildMode() === "development" },
}) as const;

const hashOf = (text: string) => Bun.hash(text).toString(36);

type Graph = {
  key: string;
  edges: Map<string, Map<string, Edge>>;
  formats: Map<string, string>;
  inputs: string[];
  /** Size and mtime of every source and the lockfile, and the names in every folder holding a source. */
  stamps: Map<string, string>;
  /** What each source imports, as written (an edit that keeps it needs no new graph). */
  imports: Map<string, string>;
  text: Map<string, string>;
};

/** The last whole-graph pass, reused while only sources' contents change (not what they import). */
let lastGraph: Graph | null = null;
const LOCKFILE = path.resolve(import.meta.dir, "../../../../bun.lock");
const transpilers = new Map<string, Bun.Transpiler>();

const stampSync = (file: string) => {
  try {
    const s = statSync(file);
    if (s.isDirectory()) return readdirSync(file).sort().join("\0");
    return `${s.mtimeMs}:${s.size}`;
  } catch {
    return "";
  }
};

const textOf = (file: string) => (JS.test(file) ? Bun.file(file).text().catch(() => "") : Promise.resolve(`asset:${stampSync(file)}:${file}`));

function importsOf(file: string, text: string): string {
  const ext = path.extname(file).slice(1);
  const loader = ext === "tsx" || ext === "jsx" ? ext : ext === "ts" || ext === "mts" ? "ts" : "js";
  let transpiler = transpilers.get(loader);
  if (!transpiler) transpilers.set(loader, (transpiler = new Bun.Transpiler({ loader: loader as "tsx" })));
  try {
    const globs = text.match(/import\.meta\.glob[^)]*\)/g) ?? [];
    return JSON.stringify([transpiler.scanImports(text).map((i) => `${i.kind}:${i.path}`), globs]);
  } catch {
    return `unparsed:${Bun.hash(text)}`;
  }
}

async function wholeGraph(spec: UiBuildSpec): Promise<Graph> {
  const key = JSON.stringify([spec, uiBuildMode()]);
  const last = lastGraph;
  if (last && last.key === key) {
    const changed: string[] = [];
    let reusable = true;
    for (const [file, stamp] of last.stamps) {
      if (stampSync(file) === stamp) continue;
      if (!last.imports.has(file)) { reusable = false; break; }
      changed.push(file);
    }
    if (reusable) {
      // Stamped before reading: a write landing during the read shows as a change next time.
      const stamps = changed.map(stampSync);
      const texts = await Promise.all(changed.map(textOf));
      if (changed.every((file, n) => importsOf(file, texts[n]!) === last.imports.get(file))) {
        changed.forEach((file, n) => {
          last.text.set(file, texts[n]!);
          last.stamps.set(file, stamps[n]!);
        });
        return last;
      }
    }
  }
  const cwd = process.cwd();
  const abs = (p: string) => path.resolve(cwd, p);
  const whole = await Bun.build({ ...options(spec), entrypoints: [spec.entry], external: spec.external, plugins: [viteCompat], metafile: true } as Parameters<typeof Bun.build>[0]);
  if (!whole.success) throw new AggregateError(whole.logs, whole.logs.map(String).join("\n"));
  const meta = (whole as unknown as { metafile: Meta }).metafile;
  const edges = new Map<string, Map<string, Edge>>();
  const formats = new Map<string, string>();
  for (const [file, input] of Object.entries(meta.inputs)) {
    const own = new Map<string, Edge>();
    for (const i of input.imports) {
      if (!i.original) continue;
      own.set(i.original, { path: i.external ? i.path : abs(i.path), external: !!i.external, kind: i.kind });
    }
    edges.set(abs(file), own);
    formats.set(abs(file), input.format ?? "esm");
  }
  const sources = [...edges.keys()].filter((file) => !isPackage(file));
  const stamps = sources.map(stampSync);
  const texts = await Promise.all(sources.map(textOf));
  const graph: Graph = { key, edges, formats, inputs: [...edges.keys()], stamps: new Map(), imports: new Map(), text: new Map() };
  const folders = new Set<string>();
  sources.forEach((file, n) => {
    graph.text.set(file, texts[n]!);
    graph.stamps.set(file, stamps[n]!);
    if (JS.test(file)) graph.imports.set(file, importsOf(file, texts[n]!));
    folders.add(path.dirname(file));
  });
  for (const folder of folders) graph.stamps.set(folder, stampSync(folder));
  graph.stamps.set(LOCKFILE, stampSync(LOCKFILE));
  lastGraph = graph;
  return graph;
}

/** Builds what the host lacks; throws the build's errors. */
export async function buildModules(spec: UiBuildSpec, request: ModulesRequest): Promise<ModulesBuild> {
  const { edges, formats, text, inputs } = await wholeGraph(spec);
  const sources = [...edges.keys()].filter((file) => !isPackage(file));

  const packages = new Set<string>();
  for (const file of sources) for (const edge of edges.get(file)!.values()) if (!edge.external && isPackage(edge.path)) packages.add(edge.path);
  const depList = [...packages].sort();
  const depsHash = hashOf(`${uiBuildMode()}\n${depList.join("\n")}`);
  const entries: DepsInfo["entries"] = {};
  depList.forEach((file, n) => (entries[file] = { name: `d${n}`, cjs: formats.get(file) === "cjs" }));

  const tagOf = (edge: Edge, kind: string): ImportTag => {
    if (edge.external) return "x";
    if (isPackage(edge.path)) return kind === "require-call" ? "r" : "d";
    return kind === "dynamic-import" ? "i" : "m";
  };

  const graph: Record<string, ModuleNode> = {};
  for (const file of sources) {
    const imports = [...edges.get(file)!.values()].map((edge) => `${tagOf(edge, edge.kind)}:${edge.path}`);
    graph[file] = { hash: hashOf(`${text.get(file)}\n${imports.join("\n")}\n${depsHash}`), imports };
  }

  const needed = sources.filter((file) => request.have[file] !== graph[file]!.hash);
  const code: Record<string, string> = {};
  const names: Record<string, string[]> = {};
  const exports: Record<string, string[]> = {};
  if (needed.length > 0) {
    const externals = {
      name: "stella-registry-externals",
      setup(build: Bun.PluginBuilder) {
        build.onResolve({ filter: /.*/ }, (args) => {
          if (args.kind === "entry-point-build" || args.kind === "entry-point-run") return undefined;
          const edge = edges.get(args.importer)?.get(args.path);
          if (!edge) return { path: `\0x:${args.path}`, external: true };
          return { path: `\0${tagOf(edge, args.kind)}:${edge.path}`, external: true };
        });
      },
    };
    const root = commonRoot(needed);
    const built = await Bun.build({ ...options(spec), entrypoints: needed, plugins: [externals, viteCompat], root } as Parameters<typeof Bun.build>[0]);
    if (!built.success) throw new AggregateError(built.logs, built.logs.map(String).join("\n"));
    const outputs = new Map<string, string>();
    for (const output of built.outputs) if (output.kind === "entry-point") outputs.set(path.normalize(output.path), await output.text());
    for (const file of needed) {
      const rel = path.relative(root, file).replace(/\.[^./\\]+$/, ".js");
      const text = outputs.get(path.normalize(rel));
      if (text === undefined) throw new Error(`no module output for ${file}`);
      const prepared = withLocalComponents(factoryOf(text));
      code[file] = prepared.source;
      if (prepared.names.length > 0) names[file] = prepared.names;
      const declared = declaredExports(prepared.source);
      if (declared.length > 0) exports[file] = declared;
    }
  }
  const helpers = shareHelpers(code, request.helpers ?? null);

  let depsCode: string | undefined;
  if (request.deps !== depsHash) {
    const lines = depList.map((file) => `export * as ${entries[file]!.name} from ${JSON.stringify(file)};`);
    // Outside the sources: a file written among them would change their folders' stamps (ui-cache.ts).
    const entry = path.join(os.tmpdir(), `stella-ui-packages-${process.pid}.js`);
    await Bun.write(entry, lines.join("\n") + "\n");
    try {
      const built = await Bun.build({ ...options(spec), entrypoints: [entry], external: spec.external, plugins: [viteCompat] } as Parameters<typeof Bun.build>[0]);
      if (!built.success) throw new AggregateError(built.logs, built.logs.map(String).join("\n"));
      depsCode = factoryOf(await built.outputs[0]!.text());
    } finally {
      await Bun.file(entry).delete().catch(() => {});
    }
  }

  return {
    entry: path.resolve(spec.entry),
    graph,
    code,
    names,
    exports,
    helpers,
    deps: { hash: depsHash, entries, code: depsCode },
    inputs,
  };
}

const FACTORY_HEAD = "(function(exports, require, module, __filename, __dirname) {";
type Prelude = { statements: Array<{ name: string; text: string; bare: boolean }>; rest: string };

/** The helper declarations Bun opens every CJS output with, and what follows them. */
function splitPrelude(source: string): Prelude | null {
  if (!source.startsWith(FACTORY_HEAD)) return null;
  const lines = source.slice(FACTORY_HEAD.length).split("\n");
  const statements: Prelude["statements"] = [];
  let i = 0;
  while (i < lines.length) {
    const name = /^(?:var|function) (__[\w$]+)/.exec(lines[i]!)?.[1];
    if (!name) break;
    let text = lines[i++]!;
    while (i < lines.length && /^(\s|[}\]);])/.test(lines[i]!)) text += `\n${lines[i++]}`;
    statements.push({ name, text, bare: /^var __[\w$]+;$/.test(text) });
  }
  return statements.length > 0 ? { statements, rest: lines.slice(i).join("\n") } : null;
}

const helperHash = (text: string) => Bun.hash(text).toString(36);

/**
 * Takes the helper preludes out of `code`'s factories where every helper is one the host shares
 * (`known`; null: the ones these factories agree on, sent along as code). A factory then reads
 * them from `require.helpers`.
 */
function shareHelpers(code: Record<string, string>, known: Record<string, string> | null): HelpersInfo {
  const preludes = new Map<string, Prelude>();
  for (const [file, source] of Object.entries(code)) {
    const prelude = splitPrelude(source);
    if (prelude) preludes.set(file, prelude);
  }
  let shared: Record<string, string>;
  let helpersCode: string | undefined;
  if (known) {
    shared = known;
  } else {
    const texts = new Map<string, { text: string; bare: boolean }>();
    const differs = new Set<string>();
    for (const prelude of preludes.values()) {
      for (const { name, text, bare } of prelude.statements) {
        const seen = texts.get(name);
        if (!seen) texts.set(name, { text, bare });
        else if (seen.text !== text) differs.add(name);
      }
    }
    for (const name of differs) texts.delete(name);
    shared = Object.fromEntries([...texts].map(([name, { text }]) => [name, helperHash(text)]));
    const values = [...texts].filter(([, { bare }]) => !bare).map(([name]) => name);
    helpersCode = `(function() {\n${[...texts.values()].map(({ text }) => text).join("\n")}\nreturn { ${values.join(", ")} };\n})`;
  }
  for (const [file, { statements, rest }] of preludes) {
    if (!statements.every(({ name, text }) => shared[name] === helperHash(text))) continue;
    const bare = statements.filter((s) => s.bare).map((s) => s.name);
    if (bare.some((name) => rest.includes(name))) continue;
    const values = statements.filter((s) => !s.bare).map((s) => s.name);
    code[file] = `${FACTORY_HEAD}var { ${values.join(", ")} } = require.helpers;\n${rest}`;
  }
  return { hashes: shared, code: helpersCode };
}

/** The `(function (exports, require, module, __filename, __dirname) {...})` of a Bun CJS output, its dynamic imports through the registry. */
function factoryOf(text: string): string {
  const start = text.indexOf("(function(");
  const body = start >= 0 ? text.slice(start) : `(function(exports, require, module, __filename, __dirname) {${text}\n})`;
  // A tagged id is an ES module's facade (ui-registry.ts), so its default import is its `default`, not Node's whole-module default.
  return body.replaceAll('import("\\x00', 'require.dynamic("\\x00').replace(/__toESM\((require\("\\x00[mid]:[^"]*"\)), 1\)/g, "__toESM($1)");
}

/** Its JSX of its own top-level components goes through `require.component` (ui-registry.ts), so they swap in place too. */
function withLocalComponents(source: string): { source: string; names: string[] } {
  const names = new Set([...source.matchAll(TOP_LEVEL_COMPONENT)].map((m) => m[1]!));
  if (names.size === 0) return { source, names: [] };
  return { source: source.replace(JSX_TYPE, (all, fn, close, name, comma) => (names.has(name) ? `${fn}${close}(require.component(${name}, "${name}")${comma}` : all)), names: [...names] };
}

function commonRoot(files: string[]): string {
  let root = path.dirname(files[0]!);
  for (const file of files) while (!file.startsWith(root + path.sep)) root = path.dirname(root);
  return root;
}


/**
 * Writes `build` (every module) as bytecode files in `outdir`: `boot.js` with what the entry
 * reaches by static imports, and one file per `import()` target with what only it reaches.
 */
export async function writeModulesFiles(build: ModulesBuild, outdir: string): Promise<{ file: string } | null> {
  const reach = (from: string, seen: Set<string>, skip: Set<string>) => {
    const stack = [from];
    while (stack.length > 0) {
      const file = stack.pop()!;
      if (seen.has(file) || skip.has(file) || !build.graph[file]) continue;
      seen.add(file);
      for (const id of build.graph[file]!.imports) if (id[0] === "m") stack.push(id.slice(2));
    }
    return seen;
  };
  const boot = reach(build.entry, new Set(), new Set());
  const groups: string[][] = [];
  const assigned = new Set(boot);
  for (let grew = true; grew; ) {
    grew = false;
    for (const file of [...assigned]) {
      for (const id of build.graph[file]!.imports) {
        const target = id.slice(2);
        if (id[0] !== "i" || assigned.has(target) || !build.graph[target]) continue;
        const group = [...reach(target, new Set(), assigned)];
        for (const member of group) assigned.add(member);
        groups.push(group);
        grew = true;
      }
    }
  }
  const lazy: Record<string, string> = {};
  groups.forEach((group, n) => { for (const file of group) lazy[file] = `lazy-${n}.js`; });
  const object = (files: string[], extra: string[] = []) =>
    `{\n${[...extra, ...files.map((file) => `${JSON.stringify(file)}: ${build.code[file]}`)].join(",\n")}\n}`;
  const bootFiles = [...boot];
  const bootSource = [
    `module.exports = {`,
    `entry: ${JSON.stringify(build.entry)},`,
    `graph: ${JSON.stringify(build.graph)},`,
    `deps: ${JSON.stringify({ hash: build.deps.hash, entries: build.deps.entries })},`,
    `lazy: ${JSON.stringify(lazy)},`,
    `names: ${JSON.stringify(build.names)},`,
    `exports: ${JSON.stringify(build.exports ?? {})},`,
    `helpers: ${JSON.stringify(build.helpers?.hashes ?? {})},`,
    `factories: ${object(bootFiles, [`${JSON.stringify(DEPS_KEY)}: ${build.deps.code}`, ...(build.helpers?.code ? [`${JSON.stringify(HELPERS_KEY)}: ${build.helpers.code}`] : [])])}`,
    `};`,
  ].join("\n");
  const files: Array<{ name: string; source: string; modules: string[] }> = [{ name: "boot.js", source: bootSource, modules: [DEPS_KEY, HELPERS_KEY, ...bootFiles] }];
  groups.forEach((group, n) => files.push({ name: `lazy-${n}.js`, source: `module.exports = ${object(group)};`, modules: group }));

  const src = path.join(outdir, ".src");
  const lines: ModulesLines = {};
  try {
    for (const file of files) {
      const input = path.join(src, file.name);
      await Bun.write(input, file.source);
      const url = `${path.join(outdir, file.name)}?swapfile`;
      const built = await Bun.build({
        entrypoints: [input],
        outdir,
        target: "bun",
        format: "cjs",
        bytecode: true,
        footer: `//# sourceURL=${url}`,
        plugins: [{ name: "stella-registry-ids", setup(b: Bun.PluginBuilder) { b.onResolve({ filter: /^\0|^[a-z]:/ }, (args) => ({ path: args.path, external: true })); } }],
      } as Parameters<typeof Bun.build>[0]);
      if (!built.success) throw new AggregateError(built.logs, built.logs.map(String).join("\n"));
      const text = await Bun.file(path.join(outdir, file.name)).text();
      const starts: Record<string, number> = {};
      const lineAt = lineIndex(text);
      for (const module of file.modules) {
        const at = text.indexOf(`${JSON.stringify(module)}: `);
        if (at >= 0) starts[module] = lineAt(at);
      }
      lines[file.name] = { url, starts };
    }
  } finally {
    await import("node:fs/promises").then((fs) => fs.rm(src, { recursive: true, force: true })).catch(() => {});
  }
  await Bun.write(path.join(outdir, MODULES_LINES), JSON.stringify(lines));
  return { file: path.join(outdir, "boot.js") };
}

const lineIndex = (text: string) => {
  const breaks: number[] = [];
  for (let at = text.indexOf("\n"); at >= 0; at = text.indexOf("\n", at + 1)) breaks.push(at);
  return (offset: number) => {
    let lo = 0;
    let hi = breaks.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (breaks[mid]! < offset) lo = mid + 1;
      else hi = mid;
    }
    return lo + 1;
  };
};
