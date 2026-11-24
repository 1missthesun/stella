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
    frontmatterText: lines.slice(1, endIndex).join("\n"),
    body: lines.slice(endIndex + 1).join("\n"),
  };
};

const parseSimpleScalar = (raw: string): unknown | undefined => {
  const trimmed = raw.trim();
  if (!trimmed) return "";
  if (trimmed === "true") return true;
  if (trimmed === "false") return false;
  if (trimmed === "null" || trimmed === "~") return null;
  if (/^-?(?:0|[1-9]\d*)(?:\.\d+)?$/.test(trimmed)) {
    const num = Number(trimmed);
    if (Number.isFinite(num)) return num;
  }
  if (trimmed.startsWith('"') && trimmed.endsWith('"') && trimmed.length >= 2) {
    try {
      return JSON.parse(trimmed);
    } catch {
      return undefined;
    }
  }
  if (trimmed.startsWith("'") && trimmed.endsWith("'") && trimmed.length >= 2) {
    return trimmed.slice(1, -1).replace(/''/g, "'");
  }
  if (
    trimmed.startsWith("{") ||
    trimmed.startsWith("[") ||
    trimmed.startsWith("|") ||
    trimmed.startsWith(">") ||
    trimmed.startsWith("&") ||
    trimmed.startsWith("*") ||
    trimmed.startsWith("!")
  ) {
    return undefined;
  }
  if (trimmed.includes(": ") || trimmed.includes(" #")) {
    return undefined;
  }
  return trimmed;
};

const parseSimpleFrontmatter = (
  frontmatterText: string,
): Record<string, unknown> | null => {
  const result: Record<string, unknown> = {};
  const lines = frontmatterText.split("\n");
  let activeListKey: string | null = null;
  let activeList: unknown[] | null = null;

  for (const rawLine of lines) {
    const line = rawLine.replace(/\r$/, "");
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;

    if (activeListKey && activeList && /^\s+-\s+/.test(line)) {
      const itemVal = parseSimpleScalar(line.replace(/^\s+-\s+/, ""));
      if (itemVal === undefined) return null;
      activeList.push(itemVal);
      continue;
    }

    if (/^\s/.test(line)) {
      return null;
    }

    activeListKey = null;
    activeList = null;

    const colonIndex = line.indexOf(":");
    if (colonIndex <= 0) return null;
    const key = line.slice(0, colonIndex).trim();
    if (!/^[A-Za-z0-9_.-]+$/.test(key)) return null;
    const rest = line.slice(colonIndex + 1).trim();

    if (!rest) {
      activeListKey = key;
      activeList = [];
      result[key] = activeList;
      continue;
    }

    if (rest.startsWith("[") && rest.endsWith("]")) {
      const inner = rest.slice(1, -1).trim();
      if (!inner) {
        result[key] = [];
        continue;
      }
      if (inner.includes('"') || inner.includes("'") || inner.includes("{") || inner.includes("[")) {
        return null;
      }
      const items: unknown[] = [];
      for (const part of inner.split(",")) {
        const val = parseSimpleScalar(part);
        if (val === undefined) return null;
        items.push(val);
      }
      result[key] = items;
      continue;
    }

    const scalar = parseSimpleScalar(rest);
    if (scalar === undefined) return null;
    result[key] = scalar;
  }

  return result;
};

export const stripFrontmatter = (content: string): string =>
  splitFrontmatter(content).body;

export const extractFrontmatter = (content: string): FrontmatterParseResult => {
  const { frontmatterText, body } = splitFrontmatter(content);
  if (frontmatterText === null) {
    return { metadata: {}, body };
  }
  const simple = parseSimpleFrontmatter(frontmatterText);
  return { metadata: simple ?? {}, body };
};

export const extractFrontmatterAsync = async (
  content: string,
): Promise<FrontmatterParseResult> => {
  const { frontmatterText, body } = splitFrontmatter(content);
  if (frontmatterText === null) {
    return { metadata: {}, body };
  }
  const simple = parseSimpleFrontmatter(frontmatterText);
  if (simple !== null) {
    return { metadata: simple, body };
  }
  try {
    const { parse: parseYaml } = await import("yaml");
    const parsed = parseYaml(frontmatterText);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return { metadata: parsed as Record<string, unknown>, body };
    }
  } catch {
    // Fall through to empty metadata on parse errors.
  }
  return { metadata: {}, body };
};
