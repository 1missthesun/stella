// A bundle bakes each module's own location in at build time: Bun turns `import.meta.url`,
// `.dir`, `.path` and a bare `__dirname` into the absolute paths of the folder it was built in.
// The bundles a first install opens from (scripts/build-app-bundle.mjs) are built in one folder
// and run from another, so these rewrite each location as an expression on the app folder the
// bundle runs from, given as `at.path(relative)` and `at.url(relative)` expression builders
// (`relative` is the module's path from the app folder, with forward slashes). Used by the Rune
// host and UI bundles (packages/desktop-rune) and the runtime worker's bytecode bundle
// (packages/runtime/scripts/build-worker-bytecode.mjs).

import path from "node:path";
import { pathToFileURL } from "node:url";

/** A source that names its own location. */
export const MODULE_PATHS = /(?<!["'`\w]|[^.]\.)import\.meta\b|(?<![."'`\w])__(dirname|filename)\b/;

const META = (names) => new RegExp(`(?<!["'\`\\w]|[^.]\\.)import\\.meta\\.(${names})\\b`, "g");
const ANY_META = /(?<!["'`\w]|[^.]\.)import\.meta\b/g;
const HAS_META = /(?<!["'`\w]|[^.]\.)import\.meta\b/;

/** `file`'s path from `root`, with forward slashes. */
export const fromRoot = (root, file) => path.relative(root, file).split(path.sep).join("/");

/**
 * Rewrites `source` (the module at `file`) so its location is computed where it runs.
 * With `wrapImportMeta`, any other `import.meta` use becomes a plain object (CommonJS bytecode
 * refuses `import.meta`); without it, those uses are left to the bundler.
 *
 * @param {string} source
 * @param {string} file
 * @param {string} root
 * @param {{ path: (relative: string) => string, url: (relative: string) => string }} at
 * @param {{ wrapImportMeta?: boolean }} [options]
 * @returns {string}
 */
export function relocateModulePaths(source, file, root, at, options = {}) {
  const dir = `(${at.path(fromRoot(root, path.dirname(file)))})`;
  const literal = `(${at.path(fromRoot(root, file))})`;
  const url = `(${at.url(fromRoot(root, file))})`;
  let out = source
    .replace(META("dirname|dir"), dir)
    .replace(META("path|filename"), literal)
    .replace(META("url"), url);
  if (options.wrapImportMeta && HAS_META.test(out)) {
    out = `var __runeImportMeta = { url: ${url}, dir: ${dir}, dirname: ${dir}, path: ${literal}, filename: ${literal}, env: process.env, main: false };\n${out.replace(ANY_META, "__runeImportMeta")}`;
  }
  if (/\b__filename\b/.test(out) && !/\b(?:const|let|var)\s+__filename\b/.test(out)) out = `var __filename = ${literal};\n${out}`;
  if (/\b__dirname\b/.test(out) && !/\b(?:const|let|var)\s+__dirname\b/.test(out)) out = `var __dirname = ${dir};\n${out}`;
  return out;
}

/**
 * Expression builders on the global functions `__stellaAppPath(relative)` and
 * `__stellaAppUrl(relative)`, which the process sets up for the app folder it runs
 * (`defineAppRoot`, or the `appRootBanner` of a CommonJS bundle). They never name `require`: a
 * module may declare its own (`const require = createRequire(import.meta.url)`). Where the
 * functions are unset (a process that never set them runs where it was built), they fall back
 * to the build folder's own paths.
 *
 * @param {string} root  the folder the bundle is built in
 */
export const atAppRoot = (root) => ({
  path: (relative) =>
    `(globalThis.__stellaAppPath ? globalThis.__stellaAppPath(${JSON.stringify(relative)}) : ${JSON.stringify(path.join(root, relative))})`,
  url: (relative) =>
    `(globalThis.__stellaAppUrl ? globalThis.__stellaAppUrl(${JSON.stringify(relative)}) : ${JSON.stringify(pathToFileURL(path.join(root, relative)).href)})`,
});

/** Sets up `__stellaAppPath`/`__stellaAppUrl` for `appRoot`, unless the process already has them. */
export function defineAppRoot(appRoot) {
  globalThis.__stellaAppPath ??= (relative) => path.join(appRoot, relative);
  globalThis.__stellaAppUrl ??= (relative) => pathToFileURL(path.join(appRoot, relative)).href;
}

/**
 * Banner of a CommonJS bundle written to `outDir`: sets the functions up for the app folder
 * `root` is to `outDir`, from where the bundle file really is.
 *
 * @param {string} outDir
 * @param {string} root
 */
export const appRootBanner = (outDir, root) =>
  `{ const p = require("node:path"), u = require("node:url"), r = p.resolve(__dirname, ${JSON.stringify(path.relative(outDir, root).split(path.sep).join("/"))}); globalThis.__stellaAppPath ??= (x) => p.join(r, x); globalThis.__stellaAppUrl ??= (x) => u.pathToFileURL(p.join(r, x)).href; }`;
