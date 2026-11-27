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
  /** What it was compiled from, to map a program position back to the source (see `locateInSource`). */
  source: string;
  fileName: string;
  /** Lines of the view's module in the program. */
  lines: number;
  /** Text `stampHooks` inserted: [offset in the module as run, length], in order. */
  inserts: Array<[number, number]>;
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

const transformOptions = (fileName: string) => ({
  transforms: (/\.jsx?$/i.test(fileName) ? ["jsx", "imports"] : ["typescript", "jsx", "imports"]) as Array<"jsx" | "imports" | "typescript">,
  jsxPragma: "__h",
  jsxFragmentPragma: "__F",
  production: true,
  disableESTransforms: true,
  filePath: fileName,
});

export function compileView(source: string, fileName = "view.tsx"): { ok: true; view: CompiledView } | { ok: false; error: ViewCompileError } {
  if (source.length > VIEW_LIMITS.maxSourceBytes) return { ok: false, error: { message: `The view is bigger than ${VIEW_LIMITS.maxSourceBytes / 1024} KB.` } };
  const key = fileName + "\0" + source;
  const hit = cache.get(key);
  if (hit) return { ok: true, view: hit };
  let code: string;
  try {
    code = transform(source, transformOptions(fileName)).code;
  } catch (caught) {
    const error = caught as { message?: string; loc?: { line: number; column: number } };
    const message = (error.message ?? String(caught)).replace(/\s*\(\d+:\d+\)$/u, "");
    // Sucrase's `loc.column` already counts from 1 (its offset from the newline before the line).
    return { ok: false, error: { message, ...(error.loc ? { line: error.loc.line, column: error.loc.column } : {}) } };
  }
  const stamped = stampHooks(code);
  const program = `${head}${stamped.code}\n});\n`;
  const view: CompiledView = { program, sourceLine: SOURCE_LINE, hash: hashOf(program), source, fileName, lines: stamped.code.split("\n").length, inserts: stamped.inserts };
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
function stampHooks(code: string): { code: string; inserts: Array<[number, number]> } {
  const literals = literalRanges(code);
  const inLiteral = (at: number) => literals.some(([a, b]) => at >= a && at < b);
  const inserts: Array<[number, number]> = [];
  let shift = 0;
  const out = code.replace(STATE_HOOK_RE, (whole, mod: string, name: string, open: string, at: number) => {
    if (inLiteral(at)) return whole;
    const lineStart = code.lastIndexOf("\n", at) + 1;
    const binding = BINDING_RE.exec(code.slice(lineStart, at))?.[1] ?? "";
    const paren = at + mod.length + 1 + name.length + (open.startsWith(".call") ? 5 : 0);
    const args = argsAt(code, paren);
    const initial = (args ?? "").replace(/^void 0,\s*/u, "").replace(/\s+/gu, " ").trim();
    const key = JSON.stringify(`${binding}(${initial})`);
    // `X.useState(` becomes `(__hk(key), X.useState)(`: text before the callee and a `)` after it.
    const prefix = `(__hk(${key}), `;
    inserts.push([at + shift, prefix.length]);
    inserts.push([at + shift + prefix.length + mod.length + 1 + name.length, 1]);
    shift += prefix.length + 1;
    return `${prefix}${mod}.${name})${open.startsWith(".call") ? open : "("}`;
  });
  return { code: out, inserts };
}

export type SourcePosition = { line: number; column: number };

const BASE64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

/** Sucrase's source map, per line of its output: [output column, source column] pairs, 0-based. */
function decodeLines(mappings: string): Array<Array<[number, number]>> {
  const lines: Array<Array<[number, number]>> = [];
  let sourceColumn = 0;
  for (const line of mappings.split(";")) {
    const segments: Array<[number, number]> = [];
    let column = 0;
    for (const segment of line.split(",")) {
      if (!segment) continue;
      const fields: number[] = [];
      let value = 0;
      let bits = 0;
      for (const char of segment) {
        const digit = BASE64.indexOf(char);
        value += (digit & 31) << bits;
        if (digit & 32) bits += 5;
        else {
          fields.push(value & 1 ? -(value >>> 1) : value >>> 1);
          value = 0;
          bits = 0;
        }
      }
      column += fields[0] ?? 0;
      if (fields.length >= 4) {
        sourceColumn += fields[3]!;
        segments.push([column, sourceColumn]);
      }
    }
    lines.push(segments);
  }
  return lines;
}

const maps = new WeakMap<CompiledView, { code: string; lines: Array<Array<[number, number]>> } | null>();

/** Sucrase's output and its map for a view, made only when a position needs mapping. */
function mapOf(view: CompiledView) {
  let map = maps.get(view);
  if (map === undefined) {
    try {
      const result = transform(view.source, { ...transformOptions(view.fileName), sourceMapOptions: { compiledFilename: "view.js" } });
      map = { code: result.code, lines: decodeLines(result.sourceMap?.mappings ?? "") };
    } catch {
      map = null;
    }
    maps.set(view, map);
  }
  return map;
}

/**
 * Where a program position (1-based line and column, as PsychoScript reports them) is in the
 * view's own source: back over the hook stamps, then through Sucrase's map. Null for a position in
 * the runtime rather than the view.
 */
export function locateInSource(view: CompiledView, programLine: number, programColumn: number): SourcePosition | null {
  const line = programLine - view.sourceLine;
  if (line < 0 || line >= view.lines) return null;
  const map = mapOf(view);
  if (!map) return { line: line + 1, column: programColumn };
  // The stamped module's offset of the position, then Sucrase's offset of it.
  const stampedLines = moduleLineStarts(view);
  let offset = (stampedLines[line] ?? 0) + Math.max(0, programColumn - 1);
  let back = 0;
  for (const [at, length] of view.inserts) {
    if (offset >= at + length) back += length;
    else if (offset >= at) {
      offset = at;
      break;
    } else break;
  }
  offset -= back;
  const lineStart = map.code.lastIndexOf("\n", offset - 1) + 1;
  const column = offset - lineStart;
  const segments = map.lines[line] ?? [];
  let best: [number, number] | null = null;
  for (const segment of segments) {
    if (segment[0] > column) break;
    best = segment;
  }
  const sourceLine = view.source.split("\n")[line] ?? "";
  const mapped = best ? best[1] + (column - best[0]) : column;
  return { line: line + 1, column: Math.max(1, Math.min(mapped + 1, sourceLine.length + 1)) };
}

const lineStarts = new WeakMap<CompiledView, number[]>();
/** Offsets of each line of the view's module as it runs (Sucrase's output plus the hook stamps). */
function moduleLineStarts(view: CompiledView): number[] {
  let starts = lineStarts.get(view);
  if (!starts) {
    const module = view.program.slice(head.length);
    starts = [0];
    for (let i = 0; i < module.length && starts.length <= view.lines; i++) if (module.charCodeAt(i) === 10) starts.push(i + 1);
    lineStarts.set(view, starts);
  }
  return starts;
}

const where = (p: SourcePosition) => `(line ${p.line}, col ${p.column})`;

/** A problem's message with where it is in the view: "… at line 10, col 59." */
export const withPosition = (message: string, line: number, column?: number): string =>
  `${message.replace(/[.\s]+$/u, "")} at line ${line}${column ? `, col ${column}` : ""}.`;

/** Rewrites `(line N, col M)` positions in a PsychoScript message to the view source's. */
export function sourcePositions(message: string, view: CompiledView): string {
  return message.replace(/\(line (\d+), col (\d+)\)/gu, (whole, line: string, col: string) => {
    const p = locateInSource(view, Number(line), Number(col));
    return p ? where(p) : whole;
  });
}

/** The innermost frame of an error's `stack` that is in the view's own source. */
export function stackPosition(stack: string, view: CompiledView): SourcePosition | null {
  for (const match of stack.matchAll(/<program>:(\d+):(\d+)/gu)) {
    const p = locateInSource(view, Number(match[1]), Number(match[2]));
    if (p) return p;
  }
  return null;
}

/** A program error's message with where in the view it happened, and that position. */
export function describeError(message: string, stack: string | undefined, view: CompiledView): { message: string; position: SourcePosition | null } {
  const mapped = sourcePositions(message, view);
  const own = /\(line (\d+), col (\d+)\)/u.exec(mapped);
  if (own && mapped !== message) return { message: mapped, position: { line: Number(own[1]), column: Number(own[2]) } };
  const position = stack ? stackPosition(stack, view) : null;
  // A position of the runtime's own (the line count past the view) says nothing to the author.
  const text = own && mapped === message ? mapped.replace(/\s*\(line \d+, col \d+\)/u, "") : mapped;
  return { message: position ? withPosition(text, position.line, position.column) : text, position };
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
