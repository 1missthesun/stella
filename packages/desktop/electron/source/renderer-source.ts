import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { absolutizeCssUrls, createTailwindBuild, cssModule, isTailwindStylesheet, type TailwindBuild } from "./css.js";
import { bundleDependencies, fileDigest, prewarmDependencyBuilder, releaseDependencyBuilder, type DepBundle } from "./deps.js";
import { envDefines, loadRendererEnv } from "./env.js";
import {
  createModuleGraph,
  isInNodeModules,
  isInside,
  isSideEffectImport,
  SOURCE_EXTENSIONS,
} from "./modules.js";
import { RENDERER_ORIGIN } from "./origin.js";
import type { RendererBuildMode } from "./renderer-protocol.js";
import { createRouteTreeGenerator } from "./routes.js";
import { loadDepTools, loadOxcTools, loadRouteTools, loadTailwindTools } from "./tools.js";

/**
 * Serves the renderer straight from its source tree, with no dev server and
 * no build: `stella-app://desktop/...` answers HTML, source modules
 * (transformed on request and cached by content), pre-bundled npm
 * dependencies, and stylesheets. Before the first window loads it walks the
 * module graph from the HTML entries, which warms the cache and finds the
 * dependencies to bundle.
 *
 * Nothing watches the files. A page load picks up whatever is on disk, and
 * `applyChanges` swaps changed files into the open windows: React Fast
 * Refresh for components, accept handlers, and stylesheets, with a reload
 * when a change reaches an entry.
 */

export { RENDERER_ORIGIN, RENDERER_SCHEME } from "./origin.js";

const HTML_ENTRIES = ["index.html", "overlay.html", "companion.html"];
/** Loaded first in every window (see the file). */
const HOT_CLIENT_URL = "/src/platform/hot/hot-client.ts";
/** Where PdfViewerCard loads pdf.js's worker from. */
const PDF_WORKER_URL = "/vendor/pdfjs/pdf.worker.min.mjs";
const PACK_PREFIX = "/@pack/";
const GRAPH_FORMAT_VERSION = "1";
/**
 * Prefixed to every module but the hot client, on its first line. A Web
 * Worker has no hot client, so its modules get no `import.meta.hot` (as in
 * production) and no-op Fast Refresh registrations.
 */
const HOT_HEADER =
  "const __stella_hot = (import.meta.hot = globalThis.__stellaHot?.module(import.meta.url)) ?? { register() {}, signature: () => (type) => type };";

const CONTENT_TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".avif": "image/avif",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf",
  ".otf": "font/otf",
  ".wasm": "application/wasm",
  ".mp3": "audio/mpeg",
  ".wav": "audio/wav",
  ".ogg": "audio/ogg",
  ".mp4": "video/mp4",
  ".webm": "video/webm",
  ".txt": "text/plain; charset=utf-8",
  ".md": "text/markdown; charset=utf-8",
};

export type SourceResponse = { status: number; type: string; body: Uint8Array };

const encoder = new TextEncoder();
const bytes = (body: string | Uint8Array) => (typeof body === "string" ? encoder.encode(body) : body);
const respond = (body: string | Uint8Array, type: string, status = 200): SourceResponse => ({
  status,
  type,
  body: bytes(body),
});
const javascript = (code: string | Uint8Array) => respond(code, CONTENT_TYPES[".js"]!);

/** A module that fails the way a broken import should: loudly, with the cause. */
const errorModule = (message: string) =>
  javascript(
    [
      `const error = new Error(${JSON.stringify(message)});`,
      `window.dispatchEvent(new CustomEvent("stella:source-error", { detail: { error } }));`,
      `throw error;`,
    ].join("\n"),
  );

const exists = (file: string) => {
  try {
    return fs.statSync(file).isFile();
  } catch {
    return false;
  }
};

/** What a window does with an update: see `hot-client.ts` for the payload. */
export type HotUpdate =
  | { type: "self"; id: string; url: string }
  | { type: "dep"; id: string; spec: string; url: string }
  | { type: "css"; id: string; url: string };
export type ApplyResult =
  | { mode: "none" | "reload" }
  | { mode: "hot"; payload: { updates: HotUpdate[]; stale: string[] } };

export type RendererSourceOptions = {
  uiRoot: string;
  repoRoot: string;
  /** The desktop-ui directory whose `.env` files supply `import.meta.env`. */
  envDir: string;
  cacheDir: string;
  mode: RendererBuildMode;
  log: (message: string) => void;
  /** Dependencies were rebundled: reload the windows. */
  onReloadNeeded: () => void;
  tailwind?: (file: string, source: string) => Promise<string>;
};

type Edge = { file: string; kind: "source" | "dep" | "asset"; dynamic: boolean; bare: boolean };
type GraphNode = { stamp: { mtimeMs: number; size: number; key: string | null }; edges: Edge[] };
type StoredGraph = {
  version: string;
  tag: string;
  lock: string;
  modules: Record<string, GraphNode>;
  dirs: Record<string, number>;
};

export const createRendererSource = async (options: RendererSourceOptions) => {
  const { uiRoot, repoRoot, log } = options;
  const mode = options.mode;
  // Hot module replacement belongs to the authoring mode: React Fast Refresh
  // registrations are emitted by the development transform, so a production
  // graph has nothing for the hot client to swap and applies changes by
  // reloading instead.
  const hot = mode === "development";
  const env = loadRendererEnv(options.envDir, mode);
  const graph = createModuleGraph({
    tools: await loadOxcTools(),
    uiRoot,
    repoRoot,
    cacheDir: options.cacheDir,
    development: hot,
    defines: envDefines(env),
  });
  const routes = createRouteTreeGenerator(loadRouteTools, uiRoot, options.cacheDir);
  const publicDir = path.join(uiRoot, "public");
  const lockfile = path.join(repoRoot, "bun.lock");
  const hotClientFile = path.join(uiRoot, HOT_CLIENT_URL);
  const graphFile = path.join(
    options.cacheDir,
    "graphs",
    `${createHash("sha256").update(`${repoRoot}\0${mode}`).digest("hex").slice(0, 16)}.json`,
  );

  const depFiles = new Set<string>();
  let deps: DepBundle | null = null;
  let depsBuild: Promise<DepBundle> | null = null;
  const buildDeps = () => {
    const build = bundleDependencies({
      loadTools: loadDepTools,
      files: depFiles,
      cacheDir: options.cacheDir,
      lockfile,
      mode,
      log,
      apart: true,
    }).then((bundle) => {
      deps = bundle;
      return bundle;
    });
    depsBuild = build;
    return build;
  };

  const tailwind = new Map<string, Promise<string>>();
  /** Incremental Tailwind builds by stylesheet: they outlive `tailwind`'s cached output. */
  const tailwindBuilds = new Map<string, TailwindBuild>();
  const compileTailwind =
    options.tailwind ??
    ((file: string, source: string) => {
      let build = tailwindBuilds.get(file);
      if (!build) {
        build = createTailwindBuild({ loadTools: loadTailwindTools, file, root: uiRoot, cacheDir: options.cacheDir });
        tailwindBuilds.set(file, build);
      }
      return build.build(source);
    });
  // What the windows were served, for hot updates: each module's resolved
  // source and stylesheet imports, the stylesheets loaded as modules, and
  // the version each updated file is now imported at (`?t=<version>`).
  const servedImports = new Map<string, Set<string>>();
  const servedStylesheets = new Set<string>();
  const tailwindStylesheets = new Set<string>();
  const versions = new Map<string, number>();
  let lastVersion = 0;

  const withVersion = (url: string, file: string) => {
    const version = versions.get(file);
    return version ? `${url}${url.includes("?") ? "&" : "?"}t=${version}` : url;
  };

  const htmlEntryModules = (name: string): string[] => {
    let html: string;
    try {
      html = fs.readFileSync(path.join(uiRoot, name), "utf8");
    } catch {
      return [];
    }
    const modules: string[] = [];
    for (const match of html.matchAll(/<script\s+type="module"\s+src="([^"]+)"/g)) {
      const file = graph.fileForUrlPath(match[1]!);
      if (file) modules.push(file);
    }
    return modules;
  };


  let nodes = new Map<string, GraphNode>();
  let packs = new Map<string, { entry: string; stylesheets: string[] }>();
  let packed = new Map<string, Set<string>>();

  const readGraph = async (lock: string): Promise<StoredGraph | null> => {
    try {
      const stored = JSON.parse(await fs.promises.readFile(graphFile, "utf8")) as StoredGraph;
      return stored.version === GRAPH_FORMAT_VERSION && stored.tag === graph.cacheTag && stored.lock === lock
        ? stored
        : null;
    } catch {
      return null;
    }
  };

  const writeGraph = async (stored: StoredGraph) => {
    await fs.promises.mkdir(path.dirname(graphFile), { recursive: true });
    const temporary = `${graphFile}.${process.pid}.${Math.random().toString(36).slice(2)}`;
    await fs.promises.writeFile(temporary, JSON.stringify(stored));
    await fs.promises.rename(temporary, graphFile);
  };

  const edgesOf = async (file: string): Promise<Edge[]> => {
    const module = await graph.load(file);
    const edges: Edge[] = [];
    for (const ref of module.imports) {
      let resolved;
      try {
        resolved = graph.resolveImport(ref.specifier, file);
      } catch {
        continue;
      }
      if (!resolved) continue;
      edges.push({
        file: resolved.file,
        kind: resolved.kind,
        dynamic: ref.dynamic,
        bare: isSideEffectImport(module.code, ref),
      });
    }
    return edges;
  };

  const validate = async (): Promise<{ changed: Set<string>; moved: boolean; count: number; loaded: number }> => {
    const lock = fileDigest(lockfile);
    const stored = await readGraph(lock);
    // No graph for these packages: the first launch, or new packages. Their
    // bundle is most likely to be rebuilt too; start its builder now.
    if (!stored && !deps) prewarmDependencyBuilder();
    const changed = new Set<string>();
    const changedDirs = new Set<string>();
    if (stored) {
      await Promise.all([
        ...Object.entries(stored.modules).map(async ([file, node]) => {
          const stats = await fs.promises.stat(file).catch(() => null);
          if (!stats || stats.mtimeMs !== node.stamp.mtimeMs || stats.size !== node.stamp.size) changed.add(file);
        }),
        ...Object.entries(stored.dirs).map(async ([dir, mtimeMs]) => {
          const stats = await fs.promises.stat(dir).catch(() => null);
          if (!stats || stats.mtimeMs !== mtimeMs) changedDirs.add(dir);
        }),
      ]);
    }
    const reusable = (file: string, node: GraphNode | undefined): node is GraphNode =>
      Boolean(
        node &&
          !changed.has(file) &&
          !changedDirs.has(path.dirname(file)) &&
          node.edges.every((edge) => edge.kind === "dep" || !changedDirs.has(path.dirname(edge.file))),
      );

    const next = new Map<string, GraphNode>();
    const seen = new Set<string>();
    let loaded = 0;
    let frontier = [...new Set([...(hot ? [hotClientFile] : []), ...HTML_ENTRIES.flatMap(htmlEntryModules)])];
    while (frontier.length > 0) {
      const following: string[] = [];
      await Promise.all(
        frontier.map(async (file) => {
          if (seen.has(file)) return;
          seen.add(file);
          const previous = stored?.modules[file];
          let node: GraphNode;
          if (reusable(file, previous)) {
            node = previous;
            if (node.stamp.key) graph.remember(file, { ...node.stamp, key: node.stamp.key });
          } else {
            loaded += 1;
            try {
              const edges = await edgesOf(file);
              node = { stamp: graph.stamp(file) ?? { mtimeMs: 0, size: 0, key: null }, edges };
            } catch (error) {
              log(`[source] ${path.relative(repoRoot, file)}: ${error instanceof Error ? error.message : String(error)}`);
              return;
            }
          }
          next.set(file, node);
          for (const edge of node.edges) {
            if (edge.kind === "source" && !seen.has(edge.file)) following.push(edge.file);
          }
        }),
      );
      frontier = following;
    }

    const previousNodes = nodes;
    const sameEdges = (a: Edge[], b: Edge[]) =>
      a.length === b.length &&
      a.every((edge, index) => {
        const other = b[index]!;
        return edge.file === other.file && edge.kind === other.kind && edge.dynamic === other.dynamic && edge.bare === other.bare;
      });
    const moved =
      previousNodes.size !== next.size ||
      [...next].some(([file, node]) => {
        const before = previousNodes.get(file);
        return !before || !sameEdges(before.edges, node.edges);
      });
    const touched = new Set(
      [...next].filter(([file, node]) => previousNodes.get(file)?.stamp.mtimeMs !== node.stamp.mtimeMs).map(([file]) => file),
    );
    nodes = next;
    depFiles.clear();
    for (const node of nodes.values()) {
      for (const edge of node.edges) if (edge.kind === "dep") depFiles.add(edge.file);
    }

    if (!stored || loaded > 0 || changedDirs.size > 0 || Object.keys(stored.modules).length !== nodes.size) {
      const dirs = new Set<string>();
      for (const [file, node] of nodes) {
        dirs.add(path.dirname(file));
        for (const edge of node.edges) if (edge.kind !== "dep") dirs.add(path.dirname(edge.file));
      }
      const dirStamps: Record<string, number> = {};
      await Promise.all(
        [...dirs].map(async (dir) => {
          const stats = await fs.promises.stat(dir).catch(() => null);
          if (stats) dirStamps[dir] = stats.mtimeMs;
        }),
      );
      void writeGraph({
        version: GRAPH_FORMAT_VERSION,
        tag: graph.cacheTag,
        lock,
        modules: Object.fromEntries(nodes),
        dirs: dirStamps,
      }).catch((error) => log(`[source] graph not saved: ${String(error)}`));
    }
    return { changed: touched, moved, count: nodes.size, loaded };
  };

  const planPacks = async () => {
    packs = new Map();
    packed = new Map();
    if (hot) return;
    const importedWithBindings = new Set<string>();
    for (const node of nodes.values()) {
      for (const edge of node.edges) {
        if (edge.kind === "asset" && path.extname(edge.file) === ".css" && (!edge.bare || edge.dynamic)) {
          importedWithBindings.add(edge.file);
        }
      }
    }
    const packable = new Map<string, boolean>();
    const isPackable = async (file: string) => {
      let result = packable.get(file);
      if (result === undefined) {
        const source = await fs.promises.readFile(file, "utf8").catch(() => null);
        result =
          source !== null &&
          !importedWithBindings.has(file) &&
          (isTailwindStylesheet(source) || !/@import\b|@charset\b|@namespace\b/.test(source));
        packable.set(file, result);
      }
      return result;
    };
    const entryOf = new Map<string, string[]>();
    const entries = HTML_ENTRIES.map((name) => ({ name, modules: htmlEntryModules(name) }));
    for (const { name, modules } of entries) {
      for (const file of modules) entryOf.set(file, [...(entryOf.get(file) ?? []), name]);
    }
    const imported = new Set<string>();
    for (const node of nodes.values()) {
      for (const edge of node.edges) if (edge.kind === "source") imported.add(edge.file);
    }
    const reachable = new Map<string, Set<string>>();
    for (const { name, modules } of entries) {
      const first = modules[0];
      const reach = new Set<string>();
      const pending = [...modules];
      while (pending.length > 0) {
        const file = pending.pop()!;
        if (reach.has(file)) continue;
        reach.add(file);
        for (const edge of nodes.get(file)?.edges ?? []) if (edge.kind === "source") pending.push(edge.file);
      }
      reachable.set(name, reach);
      if (!first || imported.has(first) || (entryOf.get(first)?.length ?? 0) > 1) continue;
      const order: string[] = [];
      const visited = new Set<string>();
      const later: string[] = [];
      const visit = (file: string) => {
        if (visited.has(file)) return;
        visited.add(file);
        for (const edge of nodes.get(file)?.edges ?? []) {
          if (edge.dynamic) {
            if (edge.kind === "source") later.push(edge.file);
          } else if (edge.kind === "source") {
            visit(edge.file);
          } else if (edge.kind === "asset" && path.extname(edge.file) === ".css" && !order.includes(edge.file)) {
            order.push(edge.file);
          }
        }
      };
      for (const file of modules) visit(file);
      for (let index = 0; index < later.length; index += 1) visit(later[index]!);
      const stylesheets: string[] = [];
      for (const file of order) if (await isPackable(file)) stylesheets.push(file);
      packs.set(name, { entry: first, stylesheets });
    }
    for (const [file, node] of nodes) {
      const pages = [...reachable].filter(([, reach]) => reach.has(file)).map(([name]) => name);
      if (pages.length === 0 || pages.some((name) => !packs.has(name))) continue;
      const skipped = new Set<string>();
      for (const edge of node.edges) {
        if (edge.kind !== "asset" || !edge.bare || edge.dynamic) continue;
        if (pages.every((name) => packs.get(name)!.stylesheets.includes(edge.file))) skipped.add(edge.file);
      }
      if (skipped.size > 0) packed.set(file, skipped);
    }
  };

  const rendered = new Map<string, Promise<Uint8Array>>();
  let generation = 0;

  let chain: Promise<void> = Promise.resolve();
  const sync = (reason: "start" | "page") => {
    const run = chain.then(async () => {
      const startedAt = Date.now();
      await routes.run().catch((error) => log(`[source] route tree: ${String(error)}`));
      const result = await validate();
      if (result.moved) {
        graph.invalidate();
        rendered.clear();
      } else {
        for (const file of result.changed) rendered.delete(file);
      }
      const bundle = deps;
      if (!bundle || [...depFiles].some((file) => !bundle.entries.has(file))) {
        rendered.clear();
        await buildDeps();
      }
      releaseDependencyBuilder();
      if (result.moved || packs.size === 0) await planPacks();
      generation += 1;
      log(`[source] ${result.count} modules ready in ${Date.now() - startedAt}ms (${reason}, ${result.loaded} read)`);
      prewarm();
    });
    chain = run.catch(() => undefined);
    return run;
  };

  let prepared: Promise<void> | null = null;
  const prepare = () => (prepared ??= sync("start"));
  const ready = async () => {
    await prepare();
    await chain;
  };

  let firstPage = true;
  /** Before a page loads: forget resolutions and compiled CSS, and regenerate the route tree. */
  const refresh = async () => {
    if (firstPage) {
      firstPage = false;
      return prepare();
    }
    await prepare();
    tailwind.clear();
    packCss.clear();
    await sync("page");
  };

  const prewarm = () => {
    if (hot) return;
    const mine = generation;
    const page = packs.get("index.html");
    if (page) void packModule("index.html").catch(() => undefined);
    void (async () => {
      const order: string[] = [];
      const seen = new Set<string>();
      const deferred: string[] = [];
      let frontier = htmlEntryModules("index.html");
      while (frontier.length > 0) {
        const following: string[] = [];
        for (const file of frontier) {
          if (seen.has(file)) continue;
          seen.add(file);
          order.push(file);
          for (const edge of nodes.get(file)?.edges ?? []) {
            if (edge.kind !== "source" || seen.has(edge.file)) continue;
            (edge.dynamic ? deferred : following).push(edge.file);
          }
        }
        frontier = following.length > 0 ? following : deferred.splice(0);
      }
      for (const file of order) {
        if (generation !== mine) return;
        await renderModule(file).catch(() => undefined);
        await new Promise((resolve) => setImmediate(resolve));
      }
    })();
  };


  const renderModule = (file: string): Promise<Uint8Array> => {
    let render = rendered.get(file);
    if (!render) {
      render = renderModuleNow(file).then(bytes);
      rendered.set(file, render);
      render.catch(() => {
        if (rendered.get(file) === render) rendered.delete(file);
      });
    }
    return render;
  };

  const renderModuleNow = async (file: string): Promise<string> => {
    const module = await graph.load(file);
    const missing: string[] = [];
    const imported = new Set<string>();
    const skipped = packed.get(file);
    const page = [...packs].find(([, pack]) => pack.entry === file)?.[0];
    const prefix = [
      hot && file !== hotClientFile ? HOT_HEADER : "",
      page ? `import ${JSON.stringify(`${PACK_PREFIX}${page}`)};` : "",
    ].join("");
    const code = graph.render(
      module,
      file,
      (ref) => {
        const resolved = graph.resolveImport(ref.specifier, file);
        if (!resolved) return null;
        if (resolved.kind !== "dep") {
          if (skipped?.has(resolved.file) && isSideEffectImport(module.code, ref)) return false;
          if (resolved.kind === "source" || path.extname(resolved.file) === ".css") {
            imported.add(resolved.file);
          }
          return withVersion(resolved.url, resolved.file);
        }
        const entry = deps?.entries.get(resolved.file);
        if (!entry) {
          missing.push(resolved.file);
          return null;
        }
        return `/@deps/${entry}`;
      },
      prefix,
    );
    if (missing.length === 0) {
      servedImports.set(file, imported);
      return code;
    }
    // A dependency nothing imported before: rebundle, then reload the
    // windows so no page mixes two bundles' copies of shared code.
    for (const file of missing) depFiles.add(file);
    log(`[source] new dependencies: ${missing.map((file) => path.relative(repoRoot, file)).join(", ")}`);
    rendered.clear();
    await buildDeps();
    options.onReloadNeeded();
    return await renderModuleNow(file);
  };

  const stylesheet = async (file: string): Promise<string> => {
    const source = await fs.promises.readFile(file, "utf8");
    let css = source;
    if (isTailwindStylesheet(source)) {
      tailwindStylesheets.add(file);
      let compiled = tailwind.get(file);
      if (!compiled) {
        compiled = compileTailwind(file, source);
        tailwind.set(file, compiled);
        compiled.catch(() => tailwind.delete(file));
      }
      css = await compiled;
    }
    return absolutizeCssUrls(css, `${RENDERER_ORIGIN}${graph.urlForFile(file)}`);
  };

  const packCss = new Map<string, Promise<Uint8Array>>();
  const packModule = (name: string): Promise<Uint8Array> => {
    let built = packCss.get(name);
    if (!built) {
      const pack = packs.get(name);
      built = (async () => {
        const sheets = await Promise.all((pack?.stylesheets ?? []).map(stylesheet));
        return bytes(cssModule(sheets.join("\n"), `${PACK_PREFIX}${name}`));
      })();
      packCss.set(name, built);
      built.catch(() => {
        if (packCss.get(name) === built) packCss.delete(name);
      });
    }
    return built;
  };

  /** Serve an HTML entry from disk, with the hot client as its first module. */
  const html = async (file: string): Promise<string> => {
    await refresh();
    const source = await fs.promises.readFile(file, "utf8");
    if (!hot) return source;
    const index = source.search(/<script\s+type="module"/);
    const tag = `<script type="module" src="${HOT_CLIENT_URL}"></script>\n    `;
    return index < 0 ? source.replace("</head>", `${tag}</head>`) : `${source.slice(0, index)}${tag}${source.slice(index)}`;
  };

  const handle = async (requestUrl: string): Promise<SourceResponse> => {
    const url = new URL(requestUrl);
    const pathname = url.pathname === "/" ? "/index.html" : url.pathname;
    try {
      if (path.extname(pathname) !== ".html") await ready();
      if (pathname.startsWith("/@deps/")) {
        const bundle = deps ?? (await depsBuild);
        const file = bundle ? path.join(bundle.dir, path.basename(pathname)) : null;
        return file && exists(file)
          ? javascript(await fs.promises.readFile(file))
          : respond("Not found", "text/plain", 404);
      }
      if (pathname.startsWith(PACK_PREFIX)) {
        return javascript(await packModule(pathname.slice(PACK_PREFIX.length)));
      }
      if (pathname === PDF_WORKER_URL) {
        // pdf.js's worker, from the copy react-pdf imports, so it always
        // matches the API version (public/vendor/pdfjs is only Vite's copy).
        const reactPdf = graph.resolveImport("react-pdf", path.join(uiRoot, "src", "main.tsx"));
        const worker = reactPdf && graph.resolveImport("pdfjs-dist/build/pdf.worker.min.mjs", reactPdf.file);
        return worker && exists(worker.file)
          ? javascript(await fs.promises.readFile(worker.file))
          : respond("Not found", "text/plain", 404);
      }
      let file = graph.fileForUrlPath(pathname);
      let isPublic = false;
      if (!file || !exists(file)) {
        const publicFile = path.resolve(publicDir, `.${decodeURIComponent(pathname)}`);
        if (publicFile.startsWith(publicDir) && exists(publicFile)) {
          file = publicFile;
          isPublic = true;
        } else {
          return respond("Not found", "text/plain", 404);
        }
      }
      const ext = path.extname(file).toLowerCase();
      if (url.searchParams.has("import")) {
        if (ext === ".css") {
          servedStylesheets.add(file);
          const prefix = hot ? HOT_HEADER : "";
          return javascript(`${prefix}${cssModule(await stylesheet(file), pathname)}`);
        }
        if (ext === ".json") {
          return javascript(`export default ${await fs.promises.readFile(file, "utf8")};\n`);
        }
        return javascript(`export default ${JSON.stringify(pathname)};\n`);
      }
      if (ext === ".css") return respond(await stylesheet(file), CONTENT_TYPES[".css"]!);
      if (!isPublic && SOURCE_EXTENSIONS.has(ext)) return javascript(await renderModule(file));
      if (!isPublic && ext === ".html") return respond(await html(file), CONTENT_TYPES[".html"]!);
      return respond(
        await fs.promises.readFile(file),
        CONTENT_TYPES[ext] ?? "application/octet-stream",
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      log(`[source] ${pathname}: ${message}`);
      const ext = path.extname(pathname).toLowerCase();
      return SOURCE_EXTENSIONS.has(ext) || url.searchParams.has("import")
        ? errorModule(message)
        : respond(message, "text/plain", 500);
    }
  };

  /** Whether a changed file can affect a page: the app's sources, or anything a window was served. */
  const isRendererInput = (file: string) =>
    file === lockfile ||
    servedImports.has(file) ||
    servedStylesheets.has(file) ||
    HTML_ENTRIES.some((name) => file === path.join(uiRoot, name)) ||
    ((isInside(path.join(uiRoot, "src"), file) || isInside(publicDir, file)) && !isInNodeModules(file));

  /** A module that takes its own updates: JSX whose exports all look like components. */
  const selfAccepts = (file: string, exports: string[]) =>
    graph.isJsxLang(file) &&
    !isInside(routes.routesDirectory, file) &&
    exports.length > 0 &&
    exports.every((name) => name === "default" || /^[A-Z]/.test(name));

  /**
   * Swap files that changed on disk (repo-relative paths) into the windows.
   * Walks up from each served changed module through its importers to the
   * nearest modules that accept the update; every module on the way is
   * re-imported at a new version, so the rest keep their instances and
   * state. Reaching a module nothing imports (an entry) means a reload.
   */
  const applyChanges = async (repoPaths: string[]): Promise<ApplyResult> => {
    await prepare();
    const changed = new Set(
      repoPaths.map((repoPath) => path.resolve(repoRoot, repoPath)).filter(isRendererInput),
    );
    if (changed.size === 0) return { mode: "none" };
    rendered.clear();
    packCss.clear();
    for (const file of changed) graph.invalidate(file);
    // Tailwind reads every source file's class names and its own stylesheets'
    // imports; a change to any other stylesheet can't change what it builds.
    const tailwindChanged = [...changed].some(
      (file) =>
        path.extname(file) !== ".css" ||
        tailwindStylesheets.has(file) ||
        [...tailwindBuilds.values()].some((build) => build.inputs.has(file)),
    );
    if (tailwindChanged) tailwind.clear();
    if ([...changed].some((file) => isInside(routes.routesDirectory, file))) {
      await routes.run().catch((error) => log(`[source] route tree: ${String(error)}`));
      changed.add(routes.routeTreeFile);
      graph.invalidate(routes.routeTreeFile);
    }
    if (changed.has(lockfile)) {
      await buildDeps();
      return { mode: "reload" };
    }
    const reloads = (file: string) =>
      file === hotClientFile || isInside(publicDir, file) || path.extname(file) === ".html";
    if (!hot || [...changed].some(reloads)) return { mode: "reload" };

    const importers = new Map<string, string[]>();
    for (const [importer, imported] of servedImports) {
      for (const file of imported) importers.set(file, [...(importers.get(file) ?? []), importer]);
    }
    const updates: HotUpdate[] = [];
    const stale = new Set<string>();
    const settled = new Set<string>();
    const pendingDeps: { id: string; spec: string; file: string }[] = [];
    const pendingSelf: { file: string; type: "self" | "css" }[] = [];
    const propagate = async (file: string, chain: string[]): Promise<boolean> => {
      if (settled.has(file)) {
        for (const link of chain) stale.add(link);
        return true;
      }
      // An import cycle: the walk that entered it covers the rest.
      if (chain.includes(file)) return true;
      const trail = [...chain, file];
      const accept = (type: "self" | "css") => {
        pendingSelf.push({ file, type });
        for (const link of trail) stale.add(link);
        settled.add(file);
        return true;
      };
      if (path.extname(file) === ".css") return accept("css");
      const module = await graph.load(file);
      if (selfAccepts(file, module.exports)) return accept("self");
      const above = importers.get(file) ?? [];
      if (above.length === 0) return false;
      for (const importer of above) {
        const importerModule = await graph.load(importer);
        const spec = importerModule.hotAccepts.find((specifier) => {
          try {
            return graph.resolveImport(specifier, importer)?.file === file;
          } catch {
            return false;
          }
        });
        if (spec) {
          pendingDeps.push({ id: graph.urlForFile(importer), spec, file });
          for (const link of trail) stale.add(link);
        } else if (!(await propagate(importer, trail))) {
          return false;
        }
      }
      settled.add(file);
      return true;
    };
    try {
      for (const file of changed) {
        // Nothing loaded it yet: the next page or import reads it from disk.
        if (!servedImports.has(file) && !importers.has(file) && !servedStylesheets.has(file)) continue;
        if (!(await propagate(file, []))) return { mode: "reload" };
      }
    } catch (error) {
      log(`[source] update: ${error instanceof Error ? error.message : String(error)}`);
      return { mode: "reload" };
    }
    // A new route tree gets new route objects throughout: the router only
    // rebuilds its routes for a new root route.
    if (stale.has(routes.routeTreeFile)) {
      for (const file of servedImports.get(routes.routeTreeFile) ?? []) stale.add(file);
    }
    // Tailwind scans the sources for classes, so any such change can change it.
    for (const file of tailwindChanged ? servedStylesheets : []) {
      if (!settled.has(file) && tailwindStylesheets.has(file)) {
        pendingSelf.push({ file, type: "css" });
        stale.add(file);
      }
    }
    // An updated module that imports a dependency the bundle lacks: rebundle and reload.
    const missing = new Set<string>();
    for (const file of stale) {
      if (path.extname(file) === ".css") continue;
      for (const ref of (await graph.load(file).catch(() => null))?.imports ?? []) {
        try {
          const resolved = graph.resolveImport(ref.specifier, file);
          if (resolved?.kind === "dep" && !deps?.entries.has(resolved.file)) missing.add(resolved.file);
        } catch {
          // Fails the same way when the window imports it.
        }
      }
    }
    if (missing.size > 0) {
      for (const file of missing) depFiles.add(file);
      await buildDeps();
      return { mode: "reload" };
    }

    const version = (lastVersion = Math.max(Date.now(), lastVersion + 1));
    for (const file of stale) versions.set(file, version);
    const urlOf = (file: string) =>
      withVersion(`${graph.urlForFile(file)}${path.extname(file) === ".css" ? "?import" : ""}`, file);
    for (const { file, type } of pendingSelf) {
      updates.push({ type, id: graph.urlForFile(file), url: urlOf(file) });
    }
    for (const { id, spec, file } of pendingDeps) {
      updates.push({ type: "dep", id, spec, url: urlOf(file) });
    }
    return {
      mode: "hot",
      payload: { updates, stale: [...stale].map((file) => graph.urlForFile(file)) },
    };
  };

  return {
    prepare,
    handle,
    applyChanges,
    dispose: () => {
      servedImports.clear();
      servedStylesheets.clear();
    },
  };
};

export type RendererSource = Awaited<ReturnType<typeof createRendererSource>>;
