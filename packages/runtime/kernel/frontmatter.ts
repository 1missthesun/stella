import { createRequire } from "node:module";

export type FrontmatterParseResult = {
  metadata: Record<string, unknown>;
  body: string;
};

const FRONTMATTER_DELIM = "---";

const splitFrontmatter = (
  content: string,
): { frontmatterText: string | null; body: string } => {
  if (!content.startsWith(FRONTMATTER_DELIM)) {
    return { frontmatterText: null, body: content };
  }

  const lines = content.split("\n");
  if (lines.length < 3) {
    return { frontmatterText: null, body: content };
  }

  let endIndex = -1;
  for (let index = 1; index < lines.length; index += 1) {
    if (lines[index].trim() === FRONTMATTER_DELIM) {
      endIndex = index;
      break;
    }
  }

  if (endIndex === -1) {
    return { frontmatterText: null, body: content };
  }

  return {
    // A CRLF file leaves the `\r` of the line before the closing `---` at
    // the end of the block, where YAML would keep it in the last value.
    frontmatterText: lines.slice(1, endIndex).join("\n").replace(/\r$/, ""),
    body: lines.slice(endIndex + 1).join("\n"),
  };
};

/*
 * Fast path for the flat frontmatter almost every skill, agent and prompt
 * uses (`key: plain words`, `key: "quoted"`, `key: [a, b]`, `key:` followed
 * by `  - item` lines), so loading them never pulls in the `yaml` package.
 * It only accepts input whose meaning under YAML 1.2's core schema (what
 * `yaml` parses with) is certain; anything else returns NOT_SIMPLE and the
 * caller parses the whole block with `yaml`. The contract is "same result
 * as `yaml`, or fall back", never "close enough".
 */
const NOT_SIMPLE = Symbol("not-simple");
type Scalar = string | number | boolean | null;

/** Plain scalars the core schema resolves to something other than a string. */
const CORE_SCHEMA_NON_STRING =
  /^(?:~|null|Null|NULL|true|True|TRUE|false|False|FALSE|[-+]?(?:\.[0-9]+|[0-9]+(?:\.[0-9]*)?)(?:[eE][-+]?[0-9]+)?|0o[0-7]+|0x[0-9a-fA-F]+|[-+]?\.(?:inf|Inf|INF)|\.(?:nan|NaN|NAN))$/;
const SIMPLE_NUMBER = /^-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?$/;
/** Characters a plain scalar may not start with, or that make its meaning depend on context. */
const PLAIN_INDICATOR_START = /^[-?:,[\]{}#&*!|>'"%@`]/;
const SIMPLE_KEY = /^[A-Za-z_][A-Za-z0-9_.-]*$/;
/** Tabs, control and Unicode line/space characters YAML treats differently from JS `trim`. */
const UNUSUAL_CHARACTER = /[\u0000-\u001f\u007f-\u00a0\u1680\u2000-\u200b\u2028\u2029\u202f\u205f\u3000\ufeff]/;
const trimSpaces = (value: string): string => value.replace(/^ +| +$/g, "");

const parseSimpleScalar = (raw: string, inFlow: boolean): Scalar | typeof NOT_SIMPLE => {
  const value = trimSpaces(raw);
  if (!value) return NOT_SIMPLE;
  if (value === "true") return true;
  if (value === "false") return false;
  if (value === "null" || value === "~") return null;
  if (SIMPLE_NUMBER.test(value)) {
    const num = Number(value);
    return Number.isFinite(num) ? num : NOT_SIMPLE;
  }
  if (CORE_SCHEMA_NON_STRING.test(value)) return NOT_SIMPLE;
  if (!inFlow && value.length >= 2 && value.startsWith('"') && value.endsWith('"')) {
    // JSON string escapes are a subset of YAML double-quoted escapes with the
    // same meaning; anything JSON rejects (YAML-only escapes, raw control
    // characters, text after the closing quote) goes to `yaml`.
    try {
      const parsed: unknown = JSON.parse(value);
      return typeof parsed === "string" ? parsed : NOT_SIMPLE;
    } catch {
      return NOT_SIMPLE;
    }
  }
  if (!inFlow && value.length >= 2 && value.startsWith("'") && value.endsWith("'")) {
    const inner = value.slice(1, -1);
    if (inner.replace(/''/g, "").includes("'")) return NOT_SIMPLE;
    return inner.replace(/''/g, "'");
  }
  if (PLAIN_INDICATOR_START.test(value)) return NOT_SIMPLE;
  if (value.includes(": ") || value.endsWith(":") || value.includes(" #")) {
    return NOT_SIMPLE;
  }
  if (inFlow && /[:#,[\]{}"']/.test(value)) return NOT_SIMPLE;
  return value;
};

const parseSimpleFrontmatter = (
  frontmatterText: string,
): Record<string, unknown> | typeof NOT_SIMPLE => {
  const result: Record<string, unknown> = {};
  let openList: { key: string; items: Scalar[]; indent: string | null } | null = null;
  const closeList = () => {
    if (openList) {
      // `key:` with nothing under it is null in YAML, not an empty list.
      result[openList.key] = openList.items.length > 0 ? openList.items : null;
      openList = null;
    }
  };

  for (const rawLine of frontmatterText.split("\n")) {
    const line = rawLine.endsWith("\r") ? rawLine.slice(0, -1) : rawLine;
    if (UNUSUAL_CHARACTER.test(line)) return NOT_SIMPLE;
    const trimmed = trimSpaces(line);
    if (!trimmed || trimmed.startsWith("#")) continue;

    const item = /^( +)- (.*)$/.exec(line);
    if (openList && item) {
      const list: { indent: string | null; items: Scalar[] } = openList;
      // Every item at one indent: a deeper `- x` would continue the
      // previous item's plain scalar in YAML, not start a new one.
      if (list.indent !== null && list.indent !== item[1]) return NOT_SIMPLE;
      list.indent = item[1]!;
      const value = parseSimpleScalar(item[2]!, false);
      if (value === NOT_SIMPLE) return NOT_SIMPLE;
      list.items.push(value);
      continue;
    }
    if (/^\s/.test(line)) return NOT_SIMPLE;
    closeList();

    const match = /^([^:]+):(?: (.*))?$/.exec(line);
    if (!match) return NOT_SIMPLE;
    const key = trimSpaces(match[1]!);
    if (
      !SIMPLE_KEY.test(key) ||
      CORE_SCHEMA_NON_STRING.test(key) ||
      key === "__proto__" ||
      Object.prototype.hasOwnProperty.call(result, key)
    ) {
      // Duplicate keys are an error to `yaml`; let it decide.
      return NOT_SIMPLE;
    }
    const rest = trimSpaces(match[2] ?? "");

    if (!rest) {
      openList = { key, items: [], indent: null };
      result[key] = null;
      continue;
    }

    if (rest.startsWith("[") && rest.endsWith("]")) {
      const inner = trimSpaces(rest.slice(1, -1));
      if (!inner) {
        result[key] = [];
        continue;
      }
      const items: Scalar[] = [];
      for (const part of inner.split(",")) {
        const value = parseSimpleScalar(part, true);
        if (value === NOT_SIMPLE) return NOT_SIMPLE;
        items.push(value);
      }
      result[key] = items;
      continue;
    }

    const scalar = parseSimpleScalar(rest, false);
    if (scalar === NOT_SIMPLE) return NOT_SIMPLE;
    result[key] = scalar;
  }

  closeList();
  return result;
};

type YamlParse = (source: string) => unknown;
let parseYaml: YamlParse | undefined;
/**
 * `yaml` is loaded only when a file needs it. It is required synchronously
 * because agent definitions (and `loadHomeAgents`, part of the extension API)
 * load synchronously.
 */
const loadYaml = (): YamlParse =>
  (parseYaml ??= (createRequire(import.meta.url)("yaml") as { parse: YamlParse }).parse);

const parseFrontmatterText = (frontmatterText: string): Record<string, unknown> => {
  const simple = parseSimpleFrontmatter(frontmatterText);
  if (simple !== NOT_SIMPLE) return simple;
  try {
    const parsed = loadYaml()(frontmatterText);
    if (parsed && typeof parsed === "object") {
      return parsed as Record<string, unknown>;
    }
  } catch {
    // Fall through to empty metadata on parse errors.
  }
  return {};
};

/** The body without its frontmatter, without parsing the frontmatter. */
export const stripFrontmatter = (content: string): string =>
  splitFrontmatter(content).body;

export const extractFrontmatter = (content: string): FrontmatterParseResult => {
  const { frontmatterText, body } = splitFrontmatter(content);
  if (frontmatterText === null) {
    return { metadata: {}, body };
  }
  return { metadata: parseFrontmatterText(frontmatterText), body };
};
