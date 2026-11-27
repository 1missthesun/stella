// TSX/TS/JSX → the program a PsychoScript live run executes. Sucrase strips types and turns JSX
// and imports into plain calls without moving lines, so a program line maps to a source line by
// a fixed offset. It is pure JavaScript, so every device compiles its own copy in a millisecond or
// two (Bun on the desktop, Hermes on phones, a browser on the web): no build step or artifact.
import { transform } from "sucrase";
import { VIEW_RUNTIME } from "./runtime.gen";
import { VIEW_LIMITS, VIEW_MODULE_EXPORTS } from "./protocol";

export type CompiledView = {
  /** The whole program: runtime, then the view's module. */
  program: string;
  /** Program line of the view source's first line (1-based). */
  sourceLine: number;
  /** Content hash of the program, for caches. */
  hash: string;
};

export type ViewCompileError = { message: string; line?: number; column?: number };

const FACTORY_PARAMS = [
  "require", "exports", "module", "console", "stella",
  "setTimeout", "clearTimeout", "setInterval", "clearInterval",
  "requestAnimationFrame", "cancelAnimationFrame", "__h", "__F", "__hk",
].join(", ");

const runtimeLines = VIEW_RUNTIME.split("\n").length;
const head = `${VIEW_RUNTIME}\nreturn await __sv_main(__input(), function (${FACTORY_PARAMS}) {\n`;
const SOURCE_LINE = runtimeLines + 2;

const hashOf = (text: string): string => {
  let a = 0x811c9dc5;
  let b = 0x01000193;
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    a = Math.imul(a ^ c, 0x01000193);
    b = Math.imul(b ^ c, 0x5bd1e995);
  }
  return (a >>> 0).toString(36) + (b >>> 0).toString(36);
};

const cache = new Map<string, CompiledView>();

export function compileView(source: string, fileName = "view.tsx"): { ok: true; view: CompiledView } | { ok: false; error: ViewCompileError } {
  if (source.length > VIEW_LIMITS.maxSourceBytes) return { ok: false, error: { message: `The view is bigger than ${VIEW_LIMITS.maxSourceBytes / 1024} KB.` } };
  const key = fileName + "\0" + source;
  const hit = cache.get(key);
  if (hit) return { ok: true, view: hit };
  let code: string;
  try {
    code = transform(source, {
      transforms: /\.jsx?$/i.test(fileName) ? ["jsx", "imports"] : ["typescript", "jsx", "imports"],
      jsxPragma: "__h",
      jsxFragmentPragma: "__F",
      production: true,
      disableESTransforms: true,
      filePath: fileName,
    }).code;
  } catch (caught) {
    const error = caught as { message?: string; loc?: { line: number; column: number } };
    const message = (error.message ?? String(caught)).replace(/\s*\(\d+:\d+\)$/u, "");
    return { ok: false, error: { message, ...(error.loc ? { line: error.loc.line, column: error.loc.column + 1 } : {}) } };
  }
  const program = `${head}${stampHooks(code)}\n});\n`;
  const view: CompiledView = { program, sourceLine: SOURCE_LINE, hash: hashOf(program) };
  cache.set(key, view);
  if (cache.size > 64) cache.delete(cache.keys().next().value!);
  return { ok: true, view };
}

/** Offsets in `code` that sit inside a string, template or comment. */
function literalRanges(code: string): Array<[number, number]> {
  const ranges: Array<[number, number]> = [];
  let i = 0;
  while (i < code.length) {
    const c = code[i]!;
    const start = i;
    if (c === "/" && code[i + 1] === "/") {
      i = code.indexOf("\n", i);
      if (i < 0) i = code.length;
    } else if (c === "/" && code[i + 1] === "*") {
      i = code.indexOf("*/", i + 2);
      i = i < 0 ? code.length : i + 2;
    } else if (c === '"' || c === "'" || c === "`") {
      i++;
      while (i < code.length && code[i] !== c) i += code[i] === "\\" ? 2 : 1;
      i++;
    } else {
      i++;
      continue;
    }
    ranges.push([start, i]);
  }
  return ranges;
}

/** The text inside the parentheses that open at `open`, or null past a short limit. */
function argsAt(code: string, open: number): string | null {
  let depth = 0;
  for (let i = open; i < code.length && i < open + 240; i++) {
    const c = code[i];
    if (c === "(" || c === "[" || c === "{") depth++;
    else if (c === ")" || c === "]" || c === "}") {
      depth--;
      if (depth === 0) return code.slice(open + 1, i);
    }
  }
  return null;
}

const STATE_HOOK_RE = /\b(_[\w$]*)\.(useState|useReducer)(\.call\(void 0,\s*|\()/gu;
const BINDING_RE = /(?:const|let|var)\s+(?:\[\s*)?([A-Za-z_$][\w$]*)[^=;\n]*=\s*$/u;

/**
 * Stamps every useState/useReducer call with a signature, its binding and initial value, so a
 * hot swap carries state to the same hook even when the agent adds, removes or reorders hooks
 * (React Fast Refresh does the same). Runs on Sucrase's output, where imported hooks have one
 * shape and JSX text is already in strings, and never adds a line.
 */
function stampHooks(code: string): string {
  const literals = literalRanges(code);
  const inLiteral = (at: number) => literals.some(([a, b]) => at >= a && at < b);
  return code.replace(STATE_HOOK_RE, (whole, mod: string, name: string, open: string, at: number) => {
    if (inLiteral(at)) return whole;
    const lineStart = code.lastIndexOf("\n", at) + 1;
    const binding = BINDING_RE.exec(code.slice(lineStart, at))?.[1] ?? "";
    const paren = at + mod.length + 1 + name.length + (open.startsWith(".call") ? 5 : 0);
    const args = argsAt(code, paren);
    const initial = (args ?? "").replace(/^void 0,\s*/u, "").replace(/\s+/gu, " ").trim();
    const key = JSON.stringify(`${binding}(${initial})`);
    return `(__hk(${key}), ${mod}.${name})${open.startsWith(".call") ? open : "("}`;
  });
}

/** Rewrites `(line N, col M)` positions in a PsychoScript message to the view source's lines. */
export function sourcePositions(message: string, view: CompiledView): string {
  return message.replace(/\(line (\d+), col (\d+)\)/gu, (whole, line: string, col: string) => {
    const n = Number(line) - view.sourceLine + 1;
    return n >= 1 ? `(line ${n}, col ${col})` : whole;
  });
}

const KNOWN = new Set<string>(VIEW_MODULE_EXPORTS);
const IMPORT_RE = /import\s+(type\s+)?([\s\S]*?)\s+from\s+["']([^"']+)["']/gu;

/**
 * Problems a device would only find when it runs the view: imports from anywhere but
 * "@stella/view", names it doesn't export, and a missing `export default`. Cheap enough for an
 * agent tool to run on every write, where TypeScript isn't available.
 */
export function lintView(source: string): ViewCompileError[] {
  const problems: ViewCompileError[] = [];
  const lineAt = (index: number) => source.slice(0, index).split("\n").length;
  for (const match of source.matchAll(IMPORT_RE)) {
    const [, typeOnly, clause = "", from] = match;
    const line = lineAt(match.index ?? 0);
    if (from !== "@stella/view" && from !== "react") {
      problems.push({ message: `A view can import only "@stella/view" (it imports "${from}").`, line });
      continue;
    }
    if (typeOnly) continue;
    const named = /\{([\s\S]*)\}/u.exec(clause)?.[1] ?? "";
    for (const part of named.split(",")) {
      const spec = part.trim();
      if (!spec || spec.startsWith("type ")) continue;
      const name = spec.split(/\s+as\s+/u)[0]!.trim();
      if (KNOWN.has(name)) continue;
      // Type-only names are fine to import; TypeScript erases them.
      if (/^(Key|Child|Element|Component|HostComponent|Color|Size|Padding|IconName|BoxProps|DragEvent|TextStyle|Option|TableColumn|ChartType|Paint|TextPaint|Graphics|PointerEvent|Context|FetchInit|FetchResponse|PickedFile)$/u.test(name)) continue;
      problems.push({ message: `"@stella/view" has no export named "${name}".`, line });
    }
  }
  if (!/export\s+default\b/u.test(source)) problems.push({ message: "A view must `export default` its root component." });
  return problems;
}
