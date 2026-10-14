export type PlistValue =
  | string
  | number
  | boolean
  | PlistValue[]
  | { [key: string]: PlistValue };

export type PlistDict = { [key: string]: PlistValue };

const MAX_DEPTH = 64;

const ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
};

const decodeText = (raw: string): string =>
  raw.replace(/&(#x[0-9a-fA-F]+|#\d+|amp|lt|gt|quot|apos);/g, (_, entity: string) => {
    if (entity.startsWith("#x")) return String.fromCodePoint(Number.parseInt(entity.slice(2), 16));
    if (entity.startsWith("#")) return String.fromCodePoint(Number.parseInt(entity.slice(1), 10));
    return ENTITIES[entity] ?? "";
  });

type Container =
  | { kind: "dict"; value: PlistDict; key: string | null }
  | { kind: "array"; value: PlistValue[] };

const SCALAR_TAGS = new Set(["key", "string", "integer", "real", "date", "data"]);

export const parsePlistXml = (content: string): PlistValue | null => {
  const tokens = /<(\/?)([A-Za-z]+)[^>]*?(\/?)>|<[?!][^>]*>/g;
  const stack: Container[] = [];
  let root: PlistValue | null = null;
  let scalar: { tag: string; start: number } | null = null;

  const place = (value: PlistValue): void => {
    const parent = stack[stack.length - 1];
    if (!parent) {
      root ??= value;
      return;
    }
    if (parent.kind === "array") {
      parent.value.push(value);
    } else if (parent.key !== null) {
      parent.value[parent.key] = value;
      parent.key = null;
    }
  };

  for (let match = tokens.exec(content); match; match = tokens.exec(content)) {
    const [, closing, tag, selfClosing] = match;
    if (!tag) continue;
    if (scalar) {
      if (closing && tag === scalar.tag) {
        const text = decodeText(content.slice(scalar.start, match.index));
        const top = stack[stack.length - 1];
        if (scalar.tag === "key") {
          if (top?.kind === "dict") top.key = text;
        } else if (scalar.tag === "integer" || scalar.tag === "real") {
          place(Number(text.trim()));
        } else {
          place(text);
        }
        scalar = null;
      }
      continue;
    }
    if (SCALAR_TAGS.has(tag)) {
      if (selfClosing) {
        if (tag === "key") {
          const top = stack[stack.length - 1];
          if (top?.kind === "dict") top.key = "";
        } else place(tag === "integer" || tag === "real" ? 0 : "");
      } else if (!closing) {
        scalar = { tag, start: tokens.lastIndex };
      }
      continue;
    }
    if (tag === "true" || tag === "false") {
      if (!closing) place(tag === "true");
      continue;
    }
    if (tag === "dict" || tag === "array") {
      if (closing) {
        const done = stack.pop();
        if (done) place(done.value);
        continue;
      }
      const container: Container =
        tag === "dict" ? { kind: "dict", value: {}, key: null } : { kind: "array", value: [] };
      if (selfClosing) {
        place(container.value);
        continue;
      }
      if (stack.length >= MAX_DEPTH) return null;
      stack.push(container);
    }
  }
  return root;
};

export const isPlistDict = (value: PlistValue | undefined): value is PlistDict =>
  typeof value === "object" && value !== null && !Array.isArray(value);
