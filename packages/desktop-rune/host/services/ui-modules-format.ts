// What the UI builder hands the host in module form (ui-modules-build.ts builds it, ui-registry.ts runs it).

/** Tags of a factory's import ids. */
export type ImportTag = "m" | "i" | "d" | "r" | "x";
export type ModuleNode = {
  hash: string;
  /** Resolved ids of its static and dynamic imports (`<tag>:<path>`), in order. */
  imports: string[];
};
export type DepsInfo = { hash: string; entries: Record<string, { name: string; cjs: boolean }> };
/** Bun's runtime helpers every factory would declare again (`__export`, `__toESM`...), shared once per registry: each one's hash, and their code. */
export type HelpersInfo = { hashes: Record<string, string>; code?: string };
/** What the host has: each module's hash, the packages bundle's, and its shared helpers' (null: send them). */
export type ModulesRequest = { have: Record<string, string>; deps: string | null; helpers?: Record<string, string> | null };
export type ModulesBuild = {
  entry: string;
  graph: Record<string, ModuleNode>;
  /** Factories of the modules whose hash the host doesn't have. */
  code: Record<string, string>;
  /** Their top-level components (rendered through `require.component`, ui-registry.ts). */
  names: Record<string, string[]>;
  /** Their export names (pre-declared on facades, so import cycles see them). */
  exports?: Record<string, string[]>;
  helpers?: HelpersInfo;
  deps: DepsInfo & { code?: string };
  inputs: string[];
};

/** The boot file's shape (ui-loader.ts reads it): its modules' factories, and where the lazy ones are. */
export type ModulesBootFile = {
  entry: string;
  graph: Record<string, ModuleNode>;
  deps: DepsInfo;
  names: Record<string, string[]>;
  exports?: Record<string, string[]>;
  helpers?: Record<string, string>;
  factories: Record<string, Function>;
  /** Each module left out of the boot file: the file in the same folder holding its factory. */
  lazy: Record<string, string>;
};
/** Next to the boot file: each file's sourceURL and the line each factory starts on (ui-scope.ts maps them to generations). */
export type ModulesLines = Record<string, { url: string; starts: Record<string, number> }>;
export const MODULES_LINES = "ui-modules.json";
export const DEPS_KEY = "stella:deps";
export const HELPERS_KEY = "stella:helpers";

/** The export names a Bun CJS factory declares in its `__export(exports_x, {...})` block. */
export const declaredExports = (source: string): string[] => {
  const at = source.indexOf("__export(exports_");
  if (at < 0) return [];
  const open = source.indexOf("{", at);
  const close = open < 0 ? -1 : source.slice(open).search(/\n\s*\}\);/);
  if (open < 0 || close < 0) return [];
  return [...source.slice(open, open + close).matchAll(/^\s*(?:"([^"]+)"|([\w$]+)): \(\) =>/gm)].map((m) => m[1] ?? m[2]!);
};
