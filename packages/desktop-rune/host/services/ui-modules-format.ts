// What the UI builder hands the host in module form (ui-modules-build.ts builds it, ui-registry.ts runs it).

/** Tags of a factory's import ids. */
export type ImportTag = "m" | "i" | "d" | "r" | "x";
export type ModuleNode = {
  hash: string;
  /** Resolved ids of its static and dynamic imports (`<tag>:<path>`), in order. */
  imports: string[];
};
export type DepsInfo = { hash: string; entries: Record<string, { name: string; cjs: boolean }> };
export type ModulesRequest = { have: Record<string, string>; deps: string | null };
export type ModulesBuild = {
  entry: string;
  graph: Record<string, ModuleNode>;
  /** Factories of the modules whose hash the host doesn't have. */
  code: Record<string, string>;
  /** Their top-level components (rendered through `require.component`, ui-registry.ts). */
  names: Record<string, string[]>;
  deps: DepsInfo & { code?: string };
  inputs: string[];
};

/** The boot file's shape (ui-loader.ts reads it): its modules' factories, and where the lazy ones are. */
export type ModulesBootFile = {
  entry: string;
  graph: Record<string, ModuleNode>;
  deps: DepsInfo;
  names: Record<string, string[]>;
  factories: Record<string, Function>;
  /** Each module left out of the boot file: the file in the same folder holding its factory. */
  lazy: Record<string, string>;
};
/** Next to the boot file: each file's sourceURL and the line each factory starts on (ui-scope.ts maps them to generations). */
export type ModulesLines = Record<string, { url: string; starts: Record<string, number> }>;
export const MODULES_LINES = "ui-modules.json";
export const DEPS_KEY = "stella:deps";
