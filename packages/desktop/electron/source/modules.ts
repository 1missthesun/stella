import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type { OxcTools } from "./tools.js";

export type ImportRef = {
  start: number;
  end: number;
  specifier: string;
  dynamic: boolean;
};

export type TransformedModule = {
  code: string;
  map: string | null;
  imports: ImportRef[];
  exports: string[];
  hotAccepts: string[];
};

export type ResolvedImport =
  | { kind: "source"; file: string; url: string }
  | { kind: "dep"; file: string }
  | { kind: "asset"; file: string; url: string };

/** Part of every cache key: bump it whenever transform output changes. */
const TRANSFORM_VERSION = "4";
const SIDE_EFFECT_IMPORT = /(?<=^|[;\s])import\s*$/;

export const isSideEffectImport = (code: string, ref: ImportRef): boolean =>
  !ref.dynamic && SIDE_EFFECT_IMPORT.test(code.slice(Math.max(0, ref.start - 16), ref.start));

export const SOURCE_EXTENSIONS = new Set([".ts", ".tsx", ".mts", ".js", ".jsx", ".mjs"]);

const toPosix = (value: string) => value.replace(/\\/g, "/");
export const isInNodeModules = (file: string) => toPosix(file).includes("/node_modules/");
export const isInside = (root: string, file: string) => {
  const relative = path.relative(root, file);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
};

const langFor = (file: string): "ts" | "tsx" | "jsx" => {
  const ext = path.extname(file);
  if (ext === ".ts" || ext === ".mts") return "ts";
  if (ext === ".tsx") return "tsx";
  return "jsx";
};

const HOT_ACCEPT = /import\.meta\.hot\.accept\(\s*(?:(["'])([^"'\n]+)\1|\[([^\]]*)\])/g;
const hotAcceptedSpecifiers = (code: string): string[] => {
  const specifiers: string[] = [];
  for (const match of code.matchAll(HOT_ACCEPT)) {
    if (match[2]) specifiers.push(match[2]);
    for (const listed of (match[3] ?? "").matchAll(/(["'])([^"'\n]+)\1/g)) specifiers.push(listed[2]!);
  }
  return specifiers;
};

export type ModuleGraphOptions = {
  tools: OxcTools;
  uiRoot: string;
  repoRoot: string;
  cacheDir: string;
  development: boolean;
  defines: Record<string, string>;
};

export const createModuleGraph = (options: ModuleGraphOptions) => {
  const { uiRoot, repoRoot } = options;
  const { ResolverFactory, parse, transform } = options.tools;
  const reactFile = (name: string) => path.join(repoRoot, "node_modules", name);
  const resolver = new ResolverFactory({
    alias: {
      "@": [path.join(uiRoot, "src")],
      react$: [reactFile("react/index.js")],
      "react/jsx-runtime": [reactFile("react/jsx-runtime.js")],
      "react/jsx-dev-runtime": [reactFile("react/jsx-dev-runtime.js")],
      "react-dom$": [reactFile("react-dom/index.js")],
      "react-dom/client": [reactFile("react-dom/client.js")],
    },
    conditionNames: ["browser", "import", "module", "default"],
    mainFields: ["browser", "module", "main"],
    aliasFields: [["browser"]],
    extensions: [".tsx", ".ts", ".jsx", ".js", ".mjs", ".json"],
    extensionAlias: {
      ".js": [".ts", ".tsx", ".js", ".jsx"],
      ".jsx": [".tsx", ".jsx"],
      ".mjs": [".mts", ".mjs"],
    },
    symlinks: true,
  });
  const definesDigest = createHash("sha256").update(JSON.stringify(options.defines)).digest("hex");
  const moduleCacheDir = path.join(options.cacheDir, "modules");
  fs.mkdirSync(moduleCacheDir, { recursive: true });
  const memory = new Map<string, { mtimeMs: number; size: number; key: string | null; module: TransformedModule }>();
  const known = new Map<string, { mtimeMs: number; size: number; key: string }>();
  const resolutions = new Map<string, ResolvedImport>();

  const repoPath = (file: string) => toPosix(path.relative(repoRoot, file));

  const urlForFile = (file: string): string => {
    if (isInside(uiRoot, file) && !isInNodeModules(file)) {
      return `/${toPosix(path.relative(uiRoot, file))}`;
    }
    const posix = toPosix(file);
    return `/@fs${posix.startsWith("/") ? "" : "/"}${posix}`;
  };

  const packagesRoot = (() => {
    try {
      return fs.realpathSync(path.join(repoRoot, "node_modules"));
    } catch {
      return null;
    }
  })();

  const fileForUrlPath = (urlPath: string): string | null => {
    const decoded = decodeURIComponent(urlPath);
    const file = decoded.startsWith("/@fs/")
      ? path.resolve(process.platform === "win32" ? decoded.slice(5) : decoded.slice(4))
      : path.resolve(uiRoot, `.${decoded}`);
    return isInside(repoRoot, file) || (packagesRoot !== null && isInside(packagesRoot, file)) ? file : null;
  };

  const resolveImport = (specifier: string, importer: string): ResolvedImport | null => {
    if (/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(specifier) || specifier.startsWith("/@")) return null;
    const cacheKey = `${path.dirname(importer)}\0${specifier}`;
    const cached = resolutions.get(cacheKey);
    if (cached) return cached;
    const result = resolver.sync(path.dirname(importer), specifier);
    if (!result.path) {
      throw new Error(
        `Cannot resolve "${specifier}" from ${path.relative(repoRoot, importer)}: ${result.error ?? "not found"}`,
      );
    }
    const file = result.path;
    const isScript = SOURCE_EXTENSIONS.has(path.extname(file)) || path.extname(file) === ".cjs";
    const resolved: ResolvedImport =
      isScript && isInNodeModules(file)
        ? { kind: "dep", file }
        : isScript
          ? { kind: "source", file, url: urlForFile(file) }
          : { kind: "asset", file, url: `${urlForFile(file)}?import` };
    resolutions.set(cacheKey, resolved);
    return resolved;
  };

  const expandGlobs = (code: string, file: string): string => {
    if (!code.includes("import.meta.glob")) return code;
    const hoisted: string[] = [];
    let counter = 0;
    const expanded = code.replace(
      /import\.meta\.glob(?:<[^>]*>)?\(\s*(["'])([^"']+)\1\s*(?:,\s*(\{[^}]*\}))?\s*\)/g,
      (_match, _quote: string, pattern: string, optionsText?: string) => {
        const eager = /eager\s*:\s*true/.test(optionsText ?? "");
        const importName = /import\s*:\s*["']([^"']+)["']/.exec(optionsText ?? "")?.[1];
        const directory = path.dirname(file);
        const matches = (fs.globSync(pattern, { cwd: directory }) as string[])
          .map((match) => toPosix(match))
          .sort();
        const entries = matches.map((match) => {
          const key = match.startsWith("../") ? match : `./${match}`;
          if (!eager) {
            const loader = importName
              ? `() => import(${JSON.stringify(key)}).then((m) => m[${JSON.stringify(importName)}])`
              : `() => import(${JSON.stringify(key)})`;
            return `${JSON.stringify(key)}: ${loader}`;
          }
          const local = `__stella_glob_${counter++}`;
          hoisted.push(
            importName === "default"
              ? `import ${local} from ${JSON.stringify(key)};`
              : importName
                ? `import { ${importName} as ${local} } from ${JSON.stringify(key)};`
                : `import * as ${local} from ${JSON.stringify(key)};`,
          );
          return `${JSON.stringify(key)}: ${local}`;
        });
        return `({ ${entries.join(", ")} })`;
      },
    );
    return hoisted.length > 0 ? `${hoisted.join("\n")}\n${expanded}` : expanded;
  };

  const collectImportsAndExports = async (
    file: string,
    code: string,
  ): Promise<Pick<TransformedModule, "imports" | "exports">> => {
    const parsed = await parse(file, code, { lang: "js", sourceType: "module" });
    const imports: ImportRef[] = [];
    const exports: string[] = [];
    for (const entry of parsed.module.staticImports) {
      const request = entry.moduleRequest;
      imports.push({ start: request.start, end: request.end, specifier: request.value, dynamic: false });
    }
    for (const entry of parsed.module.staticExports) {
      for (const exported of entry.entries) {
        const name = exported.exportName;
        exports.push(name.kind === "Default" ? "default" : name.kind === "Name" ? name.name! : "*");
        const request = exported.moduleRequest;
        if (request) {
          imports.push({ start: request.start, end: request.end, specifier: request.value, dynamic: false });
        }
      }
    }
    for (const node of parsed.program.body) {
      if (node.type === "ExportNamedDeclaration" && node.source && node.specifiers.length === 0) {
        imports.push({ start: node.source.start, end: node.source.end, specifier: node.source.value, dynamic: false });
      }
    }
    for (const entry of parsed.module.dynamicImports) {
      const literal = code.slice(entry.moduleRequest.start, entry.moduleRequest.end);
      const match = /^(["'])(.*)\1$/s.exec(literal);
      if (match) {
        imports.push({
          start: entry.moduleRequest.start,
          end: entry.moduleRequest.end,
          specifier: match[2]!,
          dynamic: true,
        });
      }
    }
    const seen = new Set<number>();
    return {
      imports: imports
        .filter((ref) => (seen.has(ref.start) ? false : (seen.add(ref.start), true)))
        .sort((a, b) => a.start - b.start),
      exports,
    };
  };

  const transformFile = async (file: string, source: string): Promise<TransformedModule> => {
    const result = await transform(repoPath(file), source, {
      lang: langFor(file),
      sourceType: "module",
      jsx: {
        runtime: "automatic",
        importSource: "react",
        development: options.development,
        ...(options.development && langFor(file) !== "ts"
          ? { refresh: { refreshReg: "__stella_hot.register", refreshSig: "__stella_hot.signature" } }
          : {}),
      },
      define: options.defines,
      target: "esnext",
      sourcemap: true,
    });
    if (result.errors.length > 0) {
      throw new Error(
        result.errors.map((error) => error.message).join("\n\n"),
      );
    }
    const code = expandGlobs(result.code, file);
    return {
      code,
      map: result.map ? JSON.stringify(result.map) : null,
      ...(await collectImportsAndExports(file, code)),
      hotAccepts: hotAcceptedSpecifiers(code),
    };
  };

  const load = async (file: string): Promise<TransformedModule> => {
    const stat = await fs.promises.stat(file);
    const hit = memory.get(file);
    if (hit && hit.mtimeMs === stat.mtimeMs && hit.size === stat.size) return hit.module;
    const remembered = known.get(file);
    if (remembered && remembered.mtimeMs === stat.mtimeMs && remembered.size === stat.size) {
      try {
        const module = JSON.parse(
          await fs.promises.readFile(path.join(moduleCacheDir, `${remembered.key}.json`), "utf8"),
        ) as TransformedModule;
        memory.set(file, { mtimeMs: stat.mtimeMs, size: stat.size, key: remembered.key, module });
        return module;
      } catch {
        known.delete(file);
      }
    }
    const source = await fs.promises.readFile(file, "utf8");
    const cacheable = !source.includes("import.meta.glob");
    const key = createHash("sha256")
      .update(`${TRANSFORM_VERSION}\0${definesDigest}\0${repoPath(file)}\0${source}`)
      .digest("hex");
    const diskPath = path.join(moduleCacheDir, `${key}.json`);
    let module: TransformedModule | null = null;
    if (cacheable) {
      try {
        module = JSON.parse(await fs.promises.readFile(diskPath, "utf8")) as TransformedModule;
      } catch {
        module = null;
      }
    }
    if (!module) {
      module = await transformFile(file, source);
      if (cacheable) {
        await fs.promises.writeFile(diskPath, JSON.stringify(module)).catch(() => undefined);
      }
    }
    memory.set(file, { mtimeMs: stat.mtimeMs, size: stat.size, key: cacheable ? key : null, module });
    return module;
  };

  const render = (
    module: TransformedModule,
    file: string,
    urlFor: (ref: ImportRef) => string | null | false,
    prefix = "",
  ): string => {
    let code = module.code;
    for (let index = module.imports.length - 1; index >= 0; index -= 1) {
      const ref = module.imports[index]!;
      const url = urlFor(ref);
      if (url === null) continue;
      if (url === false) {
        const statement = SIDE_EFFECT_IMPORT.exec(code.slice(Math.max(0, ref.start - 16), ref.start));
        if (statement) {
          const end = code[ref.end] === ";" ? ref.end + 1 : ref.end;
          code = `${code.slice(0, ref.start - statement[0].length)}${code.slice(end)}`;
        }
        continue;
      }
      code = `${code.slice(0, ref.start)}${JSON.stringify(url)}${code.slice(ref.end)}`;
    }
    if (module.map) {
      const map = module.map.replace(
        `"sources":[${JSON.stringify(repoPath(file))}]`,
        `"sources":[${JSON.stringify(urlForFile(file))}]`,
      );
      code += `\n//# sourceMappingURL=data:application/json;base64,${Buffer.from(map).toString("base64")}`;
    }
    return `${prefix}${code}`;
  };

  return {
    resolveImport,
    load,
    render,
    urlForFile,
    fileForUrlPath,
    cacheTag: `${TRANSFORM_VERSION}:${definesDigest}`,
    isJsxLang: (file: string) => langFor(file) !== "ts",
    stamp: (file: string) => {
      const hit = memory.get(file);
      return hit ? { mtimeMs: hit.mtimeMs, size: hit.size, key: hit.key } : null;
    },
    remember: (file: string, stamp: { mtimeMs: number; size: number; key: string }) => {
      known.set(file, stamp);
    },
    invalidate: (file?: string) => {
      if (file) memory.delete(file);
      resolutions.clear();
      resolver.clearCache();
    },
  };
};

