import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { touchCacheEntry } from "./cache-prune.js";
import { COMPACT, runBuilder } from "./deps.js";
import { createModuleGraph, isInNodeModules, SOURCE_EXTENSIONS } from "./modules.js";
import { RENDERER_ORIGIN } from "./origin.js";
import { BUNDLE_SCRIPT_PREFIX, bundlesDirIn } from "./page-bundle-paths.js";
import type { DepTools, OxcTools } from "./tools.js";

/**
 * A page's whole static graph as one script, served in place of its entry
 * module. Everything in it keeps exactly one instance: code the page loads
 * later (`import()`, a swap) reaches the bundled modules through `liveShim`,
 * which re-exports the script's own bindings.
 */
const PAGE_BUNDLE_FORMAT_VERSION = "2";
const KEPT_PER_PAGE = 3;
const ENTRY_ID = "\0stella-page-entry";
const EMPTY_ID = "\0stella-empty";
const ASSET_PREFIX = "\0stella-asset:";
type BundledModule = {
  /** In order: the module's export `names[n]` is the script's export `m<index>$<n>`. */
  names: string[];
  index: number;
  /** `/@deps/` URLs the module re-exports everything of. */
  stars: string[];
};

export type PageBundleMeta = {
  version: string;
  entryUrl: string;
  /** By source URL path. */
  modules: Record<string, BundledModule>;
  /** JSON module URL (with `?import`) → the script's export that holds it. */
  json: Record<string, string>;
};

export type PageBundleFile = {
  file: string;
  /** The transform's content key; null for modules that are never cached. */
  key: string | null;
};

export type PageBundleRequest = {
  kind: "page";
  id: string;
  entryFile: string;
  packUrl: string;
  packedStylesheets: string[];
  uiRoot: string;
  repoRoot: string;
  cacheDir: string;
  defines: Record<string, string>;
  depEntries: Record<string, string>;
  files: PageBundleFile[];
  jsonFiles: string[];
};

export const pageBundleId = (page: string, inputs: unknown): string => {
  const digest = createHash("sha256")
    .update(JSON.stringify([PAGE_BUNDLE_FORMAT_VERSION, page, inputs]))
    .digest("hex")
    .slice(0, 20);
  return `${page.replace(/\.html$/, "").replace(/[^a-z0-9]/gi, "_")}-${digest}`;
};

const BUNDLE_ID = /^[a-z0-9_]+-[0-9a-f]{20}$/i;

export const readPageBundleMeta = async (cacheDir: string, id: string): Promise<PageBundleMeta | null> => {
  if (!BUNDLE_ID.test(id)) return null;
  const file = path.join(bundlesDirIn(cacheDir), `${id}.json`);
  try {
    const meta = JSON.parse(await fs.promises.readFile(file, "utf8")) as PageBundleMeta;
    if (meta.version !== PAGE_BUNDLE_FORMAT_VERSION) return null;
    for (const extension of ["json", "js", "js.map"]) {
      touchCacheEntry(path.join(bundlesDirIn(cacheDir), `${id}.${extension}`));
    }
    return meta;
  } catch {
    return null;
  }
};

const MAX_UNANSWERED = 2;
const startsFile = (cacheDir: string, id: string) => path.join(bundlesDirIn(cacheDir), `${id}.starts`);

/**
 * The script, unless the last pages that got it never ran it to its end
 * (`notePageBundleStarted`): those load module by module again.
 */
export const takePageBundleCode = async (cacheDir: string, id: string): Promise<Uint8Array | null> => {
  const [code, starts] = await Promise.all([
    fs.promises.readFile(path.join(bundlesDirIn(cacheDir), `${id}.js`)).catch(() => null),
    fs.promises.readFile(startsFile(cacheDir, id), "utf8").then(Number, () => 0),
  ]);
  if (!code || starts >= MAX_UNANSWERED) return null;
  await fs.promises.writeFile(startsFile(cacheDir, id), String(starts + 1)).catch(() => undefined);
  return code;
};

export const notePageBundleStarted = async (cacheDir: string, id: string) => {
  if (BUNDLE_ID.test(id)) await fs.promises.rm(startsFile(cacheDir, id), { force: true });
};

const exported = (module: BundledModule, n: number) => `m${module.index}$${n}`;

/** The module a page already holds, for code it loads later. */
export const liveShim = (meta: PageBundleMeta, url: string): string | null => {
  const entry = JSON.stringify(meta.entryUrl);
  const json = meta.json[url];
  if (json) return `export { ${json} as default } from ${entry};\n`;
  const module = meta.modules[url];
  if (!module) return null;
  const names = module.names.map((name, n) => `${exported(module, n)} as ${JSON.stringify(name)}`);
  return [
    ...(names.length > 0 ? [`export { ${names.join(", ")} } from ${entry};`] : []),
    ...module.stars.map((star) => `export * from ${JSON.stringify(star)};`),
    "export {};",
    "",
  ].join("\n");
};

const writeAtomic = async (target: string, body: string) => {
  const temporary = `${target}.${process.pid}.${Math.random().toString(36).slice(2)}`;
  await fs.promises.writeFile(temporary, body);
  await fs.promises.rename(temporary, target);
};

const pruneOlder = async (dir: string, id: string) => {
  const page = id.slice(0, id.lastIndexOf("-") + 1);
  const names = (await fs.promises.readdir(dir)).filter((name) => name.startsWith(page) && name.endsWith(".json"));
  const dated = await Promise.all(
    names.map(async (name) => ({
      id: name.slice(0, -".json".length),
      at: (await fs.promises.stat(path.join(dir, name)).catch(() => null))?.mtimeMs ?? 0,
    })),
  );
  dated.sort((a, b) => b.at - a.at);
  await Promise.all(
    dated
      .slice(KEPT_PER_PAGE)
      .flatMap((old) => ["json", "js", "js.map", "starts"].map((extension) => path.join(dir, `${old.id}.${extension}`)))
      .map((file) => fs.promises.rm(file, { force: true })),
  );
};

export const buildPageBundle = async (options: {
  request: PageBundleRequest;
  loadTools: () => Promise<DepTools & OxcTools>;
  log: (message: string) => void;
}): Promise<void> => {
  const { request } = options;
  const startedAt = Date.now();
  const tools = await options.loadTools();
  const graph = createModuleGraph({
    tools,
    uiRoot: request.uiRoot,
    repoRoot: request.repoRoot,
    cacheDir: request.cacheDir,
    development: false,
    defines: request.defines,
  });
  const packed = new Set(request.packedStylesheets);

  const loaded = new Map<string, Awaited<ReturnType<typeof graph.load>>>();
  await Promise.all(
    request.files.map(async ({ file, key }) => {
      loaded.set(file, await graph.load(file));
      if (key !== null && graph.stamp(file)?.key !== key) throw new Error(`${file} changed while bundling`);
    }),
  );

  const depUrl = (file: string): string => {
    const entry = request.depEntries[file];
    if (!entry) throw new Error(`No dependency bundle entry for ${file}`);
    return `/@deps/${entry}`;
  };

  const collected = new Map<string, { names: Set<string>; stars: Set<string> }>();
  const collect = (file: string, visiting: Set<string>): { names: Set<string>; stars: Set<string> } => {
    const known = collected.get(file);
    if (known) return known;
    const found = { names: new Set<string>(), stars: new Set<string>() };
    const module = loaded.get(file);
    if (!module || visiting.has(file)) return found;
    visiting.add(file);
    for (const name of module.exports) if (name !== "*") found.names.add(name);
    for (const specifier of module.starReexports) {
      const resolved = graph.resolveImport(specifier, file);
      if (resolved?.kind === "dep") {
        found.stars.add(depUrl(resolved.file));
      } else if (resolved?.kind === "source") {
        const inner = collect(resolved.file, visiting);
        for (const name of inner.names) if (name !== "default") found.names.add(name);
        for (const star of inner.stars) found.stars.add(star);
      }
    }
    visiting.delete(file);
    if (visiting.size === 0) collected.set(file, found);
    return found;
  };

  const modules: Record<string, BundledModule> = {};
  const json: Record<string, string> = {};
  const entryLines = [`import ${JSON.stringify(request.packUrl)};`, `import ${JSON.stringify(request.entryFile)};`];
  for (const { file } of request.files) {
    if (file === request.entryFile) continue;
    const { names, stars } = collect(file, new Set());
    const module: BundledModule = { names: [...names], index: Object.keys(modules).length, stars: [...stars] };
    modules[graph.urlForFile(file)] = module;
    if (module.names.length === 0) continue;
    const list = module.names.map((name, n) => `${JSON.stringify(name)} as ${exported(module, n)}`);
    entryLines.push(`export { ${list.join(", ")} } from ${JSON.stringify(file)};`);
  }
  for (const file of request.jsonFiles) {
    const name = `j${Object.keys(json).length}`;
    json[`${graph.urlForFile(file)}?import`] = name;
    entryLines.push(`export { default as ${name} } from ${JSON.stringify(file)};`);
  }

  const plugin = {
    name: "stella-page-bundle",
    resolveId(source: string, importer: string | undefined, extra: { kind?: string }) {
      if (source === ENTRY_ID || source === EMPTY_ID || source.startsWith(ASSET_PREFIX)) return source;
      if (importer === ENTRY_ID) return source === request.packUrl ? { id: source, external: true } : source;
      if (!importer || extra.kind === "dynamic-import") return { id: source, external: true };
      const resolved = graph.resolveImport(source, importer);
      if (!resolved) return { id: source, external: true };
      if (resolved.kind === "dep") return { id: depUrl(resolved.file), external: true };
      if (resolved.kind === "source") return resolved.file;
      const extension = path.extname(resolved.file).toLowerCase();
      if (extension === ".json") return resolved.file;
      if (extension !== ".css") return `${ASSET_PREFIX}${resolved.url.replace(/\?import$/, "")}`;
      return packed.has(resolved.file) ? EMPTY_ID : { id: resolved.url, external: true };
    },
    async load(id: string) {
      if (id === ENTRY_ID) return { code: entryLines.join("\n"), moduleType: "js" as const };
      if (id === EMPTY_ID) return { code: "export {};", moduleType: "js" as const };
      if (id.startsWith(ASSET_PREFIX)) {
        return { code: `export default ${JSON.stringify(id.slice(ASSET_PREFIX.length))};`, moduleType: "js" as const };
      }
      const extension = path.extname(id).toLowerCase();
      if (extension === ".json") {
        return { code: `export default ${await fs.promises.readFile(id, "utf8")};`, moduleType: "js" as const };
      }
      if (!SOURCE_EXTENSIONS.has(extension) || isInNodeModules(id)) throw new Error(`Nothing loads ${id}`);
      const module = loaded.get(id) ?? (await graph.load(id));
      const url = graph.urlForFile(id);
      let code = module.code;
      for (let index = module.imports.length - 1; index >= 0; index -= 1) {
        const ref = module.imports[index]!;
        if (!ref.dynamic) continue;
        const resolved = graph.resolveImport(ref.specifier, id);
        if (!resolved) continue;
        if (resolved.kind !== "source") {
          const target = resolved.kind === "dep" ? depUrl(resolved.file) : resolved.url;
          code = `${code.slice(0, ref.start)}${JSON.stringify(target)}${code.slice(ref.end)}`;
          continue;
        }
        const target = `${resolved.url}?b=${request.id}`;
        code =
          ref.callStart === undefined || target.startsWith("/@")
            ? `${code.slice(0, ref.start)}${JSON.stringify(target)}${code.slice(ref.end)}`
            : `${code.slice(0, ref.callStart)}__stella_import(${JSON.stringify(target)}, ${JSON.stringify(url)}${code.slice(ref.end)}`;
      }
      if (code.includes("import.meta.url")) {
        code = code.replaceAll("import.meta.url", JSON.stringify(`${RENDERER_ORIGIN}${url}`));
      }
      const map = module.map ? (JSON.parse(module.map) as { sources: string[] }) : null;
      if (map) map.sources = [url];
      return { code, map: map as never, moduleType: "js" as const };
    },
  };

  const bundle = await tools.rolldown({
    input: ENTRY_ID,
    platform: "browser",
    tsconfig: false,
    treeshake: { moduleSideEffects: true },
    plugins: [plugin],
    onLog: (level, entry) => {
      if (level !== "warn" && level !== "info" && level !== "debug") options.log(`[bundle] ${entry.message}`);
    },
  });
  let output;
  try {
    ({ output } = await bundle.generate({
      format: "esm",
      codeSplitting: false,
      minify: COMPACT,
      sourcemap: "hidden",
      banner: [
        `globalThis.__stellaBundle = ${JSON.stringify(request.id)};`,
        `const __stella_import = (url, importer) => globalThis.__stellaSwap ? globalThis.__stellaSwap.load(url, importer) : import(url);`,
      ].join(""),
      footer: `void fetch(${JSON.stringify(`${BUNDLE_SCRIPT_PREFIX}${request.id}/started`)}).catch(() => undefined);`,
    }));
  } finally {
    await bundle.close();
  }
  const chunk = output.find((item) => item.type === "chunk");
  if (!chunk || chunk.type !== "chunk" || !chunk.map) throw new Error(`No bundle came out for ${request.id}`);
  const meta: PageBundleMeta = {
    version: PAGE_BUNDLE_FORMAT_VERSION,
    entryUrl: graph.urlForFile(request.entryFile),
    modules,
    json,
  };
  const map = { ...chunk.map, sourcesContent: undefined, sources: chunk.map.sources.map((source) => source.replace(/^(\.\.\/)+/, "/")) };
  const dir = bundlesDirIn(request.cacheDir);
  await fs.promises.mkdir(dir, { recursive: true });
  const sourceUrl = `${RENDERER_ORIGIN}${BUNDLE_SCRIPT_PREFIX}${request.id}.js`;
  await writeAtomic(path.join(dir, `${request.id}.js.map`), JSON.stringify(map));
  await writeAtomic(path.join(dir, `${request.id}.js`), `${chunk.code.trimEnd()}\n//# sourceURL=${sourceUrl}\n`);
  await writeAtomic(path.join(dir, `${request.id}.json`), JSON.stringify(meta));
  await pruneOlder(dir, request.id).catch(() => undefined);
  options.log(
    `[bundle] ${request.id}: ${request.files.length} modules, ${Math.round(Buffer.byteLength(chunk.code) / 1024)} KB in ${Date.now() - startedAt}ms`,
  );
};

const building = new Map<string, Promise<void>>();

/** Builds in a process of its own (see `runBuilder`); never in this one. */
export const buildPageBundleApart = (request: PageBundleRequest, log: (message: string) => void): Promise<void> => {
  let build = building.get(request.id);
  if (!build) {
    build = runBuilder(request, log).finally(() => building.delete(request.id));
    building.set(request.id, build);
  }
  return build;
};
