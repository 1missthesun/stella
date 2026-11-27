// Lets the UI bundle import desktop-ui's modules as Vite builds them: the `@/` alias,
// `import.meta.glob`, `import.meta.env`, CSS side-effect imports and asset imports.

import type { BunPlugin } from "bun";
import { existsSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import { pathToFileURL } from "node:url";
import { uiBuildMode } from "./services/ui-mode";

const DESKTOP_UI_SRC = resolve(import.meta.dir, "../../desktop-ui/src");
const REPLACE_DIR = resolve(import.meta.dir, "../ui/replace");
const EXTENSIONS = [".ts", ".tsx", ".js", ".jsx", ".mjs", ".json"];
const ASSET = /\.(png|jpe?g|gif|webp|avif|svg|ico|bmp|woff2?|ttf|otf|mp3|wav|ogg|m4a|mp4|webm|mov|wasm|pdf|txt|md|html)$/i;
const SOURCE = /\.(m?[jt]sx?)$/;

function resolveFile(base: string): string | undefined {
  if (existsSync(base) && statSync(base).isFile()) return base;
  for (const ext of EXTENSIONS) if (existsSync(base + ext)) return base + ext;
  for (const ext of EXTENSIONS) {
    const index = join(base, `index${ext}`);
    if (existsSync(index)) return index;
  }
  return undefined;
}

export function resolveSpecifier(spec: string, importer: string): string | undefined {
  if (spec.startsWith("@/")) return resolveFile(join(DESKTOP_UI_SRC, spec.slice(2)));
  if (spec.startsWith("./") || spec.startsWith("../")) return resolveFile(resolve(dirname(importer), spec));
  if (spec.startsWith("/")) return resolveFile(spec);
  return undefined;
}

/** `ui/replace/<path>` stands in for desktop-ui's `src/<path>`, whatever either's extension, except to itself. */
export function replacementFor(path: string, importer: string): string | undefined {
  if (!path.startsWith(DESKTOP_UI_SRC + sep)) return undefined;
  const base = join(REPLACE_DIR, relative(DESKTOP_UI_SRC, path)).replace(SOURCE, "");
  if (importer.replace(SOURCE, "") === base) return undefined;
  for (const ext of EXTENSIONS) if (existsSync(base + ext)) return base + ext;
  return undefined;
}

function viteEnv(): Record<string, unknown> {
  const mode = uiBuildMode();
  const env: Record<string, unknown> = { MODE: mode, DEV: mode === "development", PROD: mode === "production", SSR: false, BASE_URL: process.env.STELLA_UI_BASE_URL ?? "/" };
  for (const [k, v] of Object.entries(process.env)) if (k.startsWith("VITE_")) env[k] = v;
  return env;
}

/** Finds the end of a balanced bracket run starting at `open` (an index of `(` or `<`). */
function closeOf(src: string, open: number): number {
  const pairs: Record<string, string> = { "(": ")", "<": ">", "[": "]", "{": "}" };
  const stack = [pairs[src[open]]];
  let quote = "";
  for (let i = open + 1; i < src.length; i++) {
    const c = src[i];
    if (quote) {
      if (c === "\\") i++;
      else if (c === quote) quote = "";
      continue;
    }
    if (c === '"' || c === "'" || c === "`") quote = c;
    else if (c in pairs && (c !== "<" || stack[0] === ">")) stack.unshift(pairs[c]);
    else if (c === stack[0]) {
      stack.shift();
      if (stack.length === 0) return i;
    }
  }
  return -1;
}

type GlobOptions = { eager?: boolean; import?: string; query?: string | Record<string, string>; as?: string };

const slashed = (path: string) => (sep === "\\" ? path.replaceAll("\\", "/") : path);

function expandGlob(file: string, patterns: string[]): Map<string, string> {
  const dir = dirname(file);
  const out = new Map<string, string>();
  const include = patterns.filter((p) => !p.startsWith("!"));
  const exclude = patterns.filter((p) => p.startsWith("!")).map((p) => new Bun.Glob(p.slice(1)));
  for (const pattern of include) {
    const absolute = slashed(pattern.startsWith("/") ? join(DESKTOP_UI_SRC, "..", pattern) : resolve(dir, pattern.startsWith("@/") ? join(DESKTOP_UI_SRC, pattern.slice(2)) : pattern));
    const wildcard = absolute.search(/[*{[?]/);
    const root = (wildcard < 0 ? absolute : absolute.slice(0, wildcard)).replace(/[^/]*$/, "");
    if (!existsSync(root)) continue;
    const glob = new Bun.Glob(absolute.slice(root.length));
    for (const found of glob.scanSync({ cwd: root, onlyFiles: true })) {
      const match = slashed(found);
      const path = root + match;
      const fromDir = slashed(relative(dir, path));
      const key = pattern.startsWith("./") || pattern.startsWith("../") ? (fromDir.startsWith(".") ? fromDir : `./${fromDir}`) : pattern.startsWith("@/") ? `@/${slashed(relative(DESKTOP_UI_SRC, path))}` : `/${slashed(relative(join(DESKTOP_UI_SRC, ".."), path))}`;
      if (exclude.some((g) => g.match(key) || g.match(match))) continue;
      out.set(key, path);
    }
  }
  return new Map([...out].sort(([a], [b]) => a.localeCompare(b)));
}

function querySuffix(o: GlobOptions): string {
  if (o.as === "raw" || o.as === "url") return `?${o.as}`;
  if (!o.query) return "";
  if (typeof o.query === "string") return o.query.startsWith("?") ? o.query : `?${o.query}`;
  return `?${new URLSearchParams(o.query)}`;
}

function rewriteGlobs(src: string, file: string): string {
  const hoisted: string[] = [];
  let out = "";
  let at = 0;
  let n = 0;
  for (;;) {
    const hit = src.indexOf("import.meta.glob", at);
    if (hit < 0) break;
    let i = hit + "import.meta.glob".length;
    while (/\s/.test(src[i])) i++;
    if (src[i] === "<") i = closeOf(src, i) + 1;
    while (/\s/.test(src[i])) i++;
    if (src[i] !== "(") {
      out += src.slice(at, i);
      at = i;
      continue;
    }
    const end = closeOf(src, i);
    const [patterns, options = {}] = new Function(`return [${src.slice(i + 1, end)}]`)() as [string | string[], GlobOptions?];
    const files = expandGlob(file, Array.isArray(patterns) ? patterns : [patterns]);
    const suffix = querySuffix(options);
    const entries: string[] = [];
    let m = 0;
    for (const [key, path] of files) {
      const spec = JSON.stringify(path + suffix);
      if (options.eager) {
        const name = `__vite_glob_${n}_${m++}`;
        hoisted.push(options.import && options.import !== "*" ? `import { ${options.import} as ${name} } from ${spec};` : `import * as ${name} from ${spec};`);
        entries.push(`${JSON.stringify(key)}: ${name}`);
      } else {
        const pick = options.import && options.import !== "*" ? `.then((m) => m[${JSON.stringify(options.import)}])` : "";
        const target = path.endsWith(".json") && !suffix ? `String(${spec})` : spec;
        entries.push(`${JSON.stringify(key)}: () => import(${target})${pick}`);
      }
    }
    out += src.slice(at, hit) + `({${entries.join(", ")}})`;
    at = end + 1;
    n++;
  }
  return hoisted.join("\n") + (hoisted.length ? "\n" : "") + out + src.slice(at);
}

export const viteCompat: BunPlugin = {
  name: "stella-vite-compat",
  setup(build) {
    // The UI is a client, as in Chromium; Bun's `bun` condition would make the router a server.
    build.onResolve({ filter: /^@tanstack\/router-core\/isServer$/ }, (args) => {
      const pkg = Bun.resolveSync("@tanstack/router-core/package.json", args.importer);
      return { path: join(dirname(pkg), "dist/esm/isServer/client.js") };
    });

    build.onResolve({ filter: /^@\// }, (args) => {
      const path = resolveSpecifier(args.path, args.importer);
      return path ? { path: replacementFor(path, args.importer) ?? path } : undefined;
    });

    build.onResolve({ filter: /^\.\.?\// }, (args) => {
      if (!args.importer.startsWith(DESKTOP_UI_SRC + sep)) return undefined;
      const path = resolveSpecifier(args.path, args.importer);
      const replacement = path && replacementFor(path, args.importer);
      return replacement ? { path: replacement } : undefined;
    });

    build.onResolve({ filter: /\?(url|raw|inline|worker|worker&url)$/ }, (args) => {
      const [spec, query] = args.path.split("?");
      const path = resolveSpecifier(spec, args.importer) ?? (spec.startsWith("/") ? spec : undefined);
      return path ? { path, namespace: "vite-asset", pluginData: { query } } : undefined;
    });

    build.onLoad({ filter: /.*/, namespace: "vite-asset" }, (args) => {
      const query = (args as { pluginData?: { query?: string } }).pluginData?.query ?? "url";
      if (query === "raw") return { contents: `export default ${JSON.stringify(readFileSync(args.path, "utf8"))};`, loader: "js" };
      return { contents: `export default ${JSON.stringify(pathToFileURL(args.path).href)};`, loader: "js" };
    });

    build.onLoad({ filter: /\.css$/ }, () => ({ contents: "export default {};", loader: "js" }));

    build.onLoad({ filter: ASSET }, (args) => {
      if (args.path.includes("/node_modules/") && !/\.(png|jpe?g|gif|webp|svg)$/i.test(args.path)) return undefined;
      return { contents: `export default ${JSON.stringify(pathToFileURL(args.path).href)};`, loader: "js" };
    });

    build.onLoad({ filter: SOURCE }, (args) => {
      if (args.path.includes("/node_modules/")) return undefined;
      const src = readFileSync(args.path, "utf8");
      const glob = src.includes("import.meta.glob");
      const env = src.includes("import.meta.env");
      if (!glob && !env) return undefined;
      let contents = glob ? rewriteGlobs(src, args.path) : src;
      if (env) contents = contents.replace(/\bimport\.meta\.env\b/g, `(${JSON.stringify(viteEnv())})`);
      const ext = args.path.match(SOURCE)![1];
      return { contents, loader: (ext === "mjs" ? "js" : ext) as "ts" | "tsx" | "js" | "jsx" };
    });
  },
};
