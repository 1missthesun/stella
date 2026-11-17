/**
 * Ported from Pi (https://github.com/earendil-works/pi), MIT License,
 * Copyright (c) 2025 Mario Zechner.
 *
 * BM25 ranking for `tools.$search`, ported from Pi's tool search
 * (`@earendil-works/pi-durable` `search.ts`, which `tool_search` and code
 * mode's `searchTools()` use), with one addition from Stella's earlier
 * ranker: a query word inside a tool's name counts as a name match even
 * when the name has no boundary there (`draft` in `gmail_createdraft`).
 *
 * Okapi BM25 (k1 1.2, b 0.75) over a tool's text (description, search terms,
 * parameter names and descriptions), with the name as a separate field:
 * - A tool that matches more of the query's words, in any field, ranks above
 *   one that matches fewer, whatever their scores.
 * - A query word in the name scores more than any number of mentions in the text.
 * - A tool whose whole local name (after the last `__`) is in the query gets a
 *   bonus worth one more match of every query word.
 * - A query that is exactly a tool's name, or its name after a `__`, ranks it first.
 *
 * Indexing a tool (walking its schema and splitting its text into words) is
 * most of the cost, so indexed tools are cached: by object while the catalog
 * hands out the same objects, else by name while the tool's description,
 * search terms and schema are unchanged, as connector tools arrive as fresh
 * objects on every search.
 */

/** What the ranker reads of a tool. */
export type RankableTool = {
  name: string;
  description?: string;
  parameters?: Record<string, unknown>;
  demoted?: { searchTerms?: readonly string[] };
};

type IndexedTool = {
  name: string;
  lowerName: string;
  normalizedName: string;
  nameTerms: ReadonlySet<string>;
  localNameTerms: readonly string[];
  textCounts: ReadonlyMap<string, number>;
  textLength: number;
};

const K1 = 1.2;
const B = 0.75;
/** A name match counts this many times the word's IDF; the text part is at most `K1 + 1` (2.2) times. */
const NAME_WEIGHT = 3;
/** Shortest query word that matches inside a name without a word boundary. */
const MIN_NAME_SUBSTRING = 4;
const MAX_SCHEMA_DEPTH = 6;
/** Tool names whose index is kept; well above the largest catalogs (a few thousand tools). */
const MAX_CACHED_TOOLS = 20_000;

const STOP_WORDS: ReadonlySet<string> = new Set([
  "a",
  "an",
  "and",
  "are",
  "as",
  "at",
  "be",
  "by",
  "for",
  "from",
  "in",
  "is",
  "it",
  "of",
  "on",
  "or",
  "that",
  "the",
  "this",
  "to",
  "with",
]);

let wordSegmenter: Intl.Segmenter | null | undefined;
const segmenter = (): Intl.Segmenter | null => {
  if (wordSegmenter === undefined) {
    wordSegmenter =
      typeof Intl !== "undefined" && typeof Intl.Segmenter === "function"
        ? new Intl.Segmenter(undefined, { granularity: "word" })
        : null;
  }
  return wordSegmenter;
};

/** Naive singular form, so `issues` matches `issue` and `searches` matches `search`. */
const stem = (term: string): string => {
  if (term.length > 4 && term.endsWith("ies")) return `${term.slice(0, -3)}y`;
  if (term.length > 4 && /(ches|shes|sses|xes|zes)$/.test(term)) {
    return term.slice(0, -2);
  }
  if (term.length > 3 && term.endsWith("s") && !term.endsWith("ss")) {
    return term.slice(0, -1);
  }
  return term;
};

/** Words of any script, split at identifier boundaries, without English stop words, singular. */
export const tokenizeSearchText = (text: string): string[] => {
  const normalized = text
    .normalize("NFC")
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2")
    .toLowerCase()
    .replace(/[^\p{L}\p{M}\p{N}]+/gu, " ");
  // Plain ASCII splits into the same words at spaces; only other text (Chinese
  // written without spaces) needs the segmenter, which costs about 15 splits.
  const words =
    /^[a-z0-9 ]*$/.test(normalized) || !segmenter()
      ? normalized.split(" ")
      : Array.from(segmenter()!.segment(normalized), (segment) =>
          segment.isWordLike ? segment.segment : "",
        );
  return words
    .filter((word) => word.length > 0 && !STOP_WORDS.has(word))
    .map((word) => (/^[a-z0-9]+$/.test(word) ? stem(word) : word));
};

/** Lowercase with characters invalid in identifiers as `_`, so `dev-radius` matches `dev_radius`. */
const normalizeName = (name: string): string =>
  name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_$]/g, "_");

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === "object" && !Array.isArray(value);

/** Schema descriptions and property names, recursively. */
const collectSchemaText = (
  schema: unknown,
  depth: number,
  parts: string[],
): void => {
  if (depth > MAX_SCHEMA_DEPTH || !isRecord(schema)) return;
  if (typeof schema.description === "string") parts.push(schema.description);
  if (isRecord(schema.properties)) {
    for (const [name, property] of Object.entries(schema.properties)) {
      parts.push(name);
      collectSchemaText(property, depth + 1, parts);
    }
  }
  collectSchemaText(schema.items, depth + 1, parts);
  for (const key of ["anyOf", "oneOf", "allOf"]) {
    const variants = schema[key];
    if (Array.isArray(variants)) {
      for (const variant of variants) {
        collectSchemaText(variant, depth + 1, parts);
      }
    }
  }
};

const indexTool = (tool: RankableTool): IndexedTool => {
  const parts = [
    typeof tool.description === "string" ? tool.description : "",
    ...(tool.demoted?.searchTerms ?? []),
  ];
  collectSchemaText(tool.parameters, 0, parts);
  const textCounts = new Map<string, number>();
  for (const term of tokenizeSearchText(parts.join(" "))) {
    textCounts.set(term, (textCounts.get(term) ?? 0) + 1);
  }
  let textLength = 0;
  for (const count of textCounts.values()) textLength += count;
  const segments = tool.name.split("__");
  return {
    name: tool.name,
    lowerName: tool.name.toLowerCase(),
    normalizedName: normalizeName(tool.name),
    nameTerms: new Set(tokenizeSearchText(tool.name)),
    localNameTerms: [
      ...new Set(tokenizeSearchText(segments[segments.length - 1] ?? "")),
    ],
    textCounts,
    textLength,
  };
};

type CachedTool = {
  description: string;
  searchTerms: string;
  parameters: string;
  index: IndexedTool;
};

const byObject = new WeakMap<object, IndexedTool>();
/** The newest index of each tool name, with what it was built from. */
const byName = new Map<string, CachedTool>();
const parameterText = new WeakMap<object, string>();

const parametersOf = (tool: RankableTool): string => {
  const parameters = tool.parameters;
  if (!parameters) return "";
  const known = parameterText.get(parameters);
  if (known !== undefined) return known;
  let text = "";
  try {
    text = JSON.stringify(parameters) ?? "";
  } catch {
    text = "";
  }
  parameterText.set(parameters, text);
  return text;
};

/** A tool's index: by object, else by name when built from the same content, else built and remembered. */
const indexed = (tool: RankableTool): IndexedTool => {
  const known = byObject.get(tool);
  if (known) return known;
  const description =
    typeof tool.description === "string" ? tool.description : "";
  const searchTerms = (tool.demoted?.searchTerms ?? []).join("\u0000");
  const parameters = parametersOf(tool);
  const cached = byName.get(tool.name);
  let index: IndexedTool;
  if (
    cached &&
    cached.description === description &&
    cached.searchTerms === searchTerms &&
    cached.parameters === parameters
  ) {
    index = cached.index;
    // Most recently used last, so the oldest go first.
    byName.delete(tool.name);
  } else {
    index = indexTool(tool);
    if (cached) byName.delete(tool.name);
    if (byName.size >= MAX_CACHED_TOOLS) {
      const oldest = byName.keys().next().value;
      if (oldest !== undefined) byName.delete(oldest);
    }
  }
  byName.set(tool.name, { description, searchTerms, parameters, index });
  byObject.set(tool, index);
  return index;
};

/** The best matches for `query`, best first; ties go by name, as before. */
export const rankTools = <T extends RankableTool>(
  tools: readonly T[],
  query: string,
  limit: number,
): T[] => {
  const queryTerms = [...new Set(tokenizeSearchText(query))];
  if (queryTerms.length === 0 || tools.length === 0 || limit <= 0) return [];
  const documents = tools.map(indexed);
  const nameMatches = (document: IndexedTool, term: string): boolean =>
    document.nameTerms.has(term) ||
    (term.length >= MIN_NAME_SUBSTRING && document.lowerName.includes(term));
  let totalLength = 0;
  for (const document of documents) totalLength += document.textLength;
  const averageLength = totalLength / documents.length || 1;
  const idf = new Map<string, number>();
  for (const term of queryTerms) {
    let frequency = 0;
    for (const document of documents) {
      if (nameMatches(document, term) || document.textCounts.has(term)) {
        frequency += 1;
      }
    }
    idf.set(
      term,
      Math.log(1 + (documents.length - frequency + 0.5) / (frequency + 0.5)),
    );
  }
  let fullNameBonus = 0;
  for (const value of idf.values()) fullNameBonus += value;
  const querySet = new Set(queryTerms);
  const exactQuery = normalizeName(query);
  const matches: {
    index: number;
    name: string;
    score: number;
    covered: number;
    exact: boolean;
  }[] = [];
  documents.forEach((document, index) => {
    const norm = K1 * (1 - B + (B * document.textLength) / averageLength);
    let score = 0;
    let covered = 0;
    for (const term of queryTerms) {
      const count = document.textCounts.get(term) ?? 0;
      const weight =
        (nameMatches(document, term) ? NAME_WEIGHT : 0) +
        (count * (K1 + 1)) / (count + norm);
      if (weight > 0) covered += 1;
      score += (idf.get(term) ?? 0) * weight;
    }
    if (score === 0) return;
    const local = document.localNameTerms;
    if (local.length > 0 && local.every((term) => querySet.has(term))) {
      score += fullNameBonus;
    }
    matches.push({
      index,
      name: document.name,
      score,
      covered,
      exact:
        document.normalizedName === exactQuery ||
        document.normalizedName.endsWith(`__${exactQuery}`),
    });
  });
  return matches
    .sort(
      (left, right) =>
        Number(right.exact) - Number(left.exact) ||
        right.covered - left.covered ||
        right.score - left.score ||
        left.name.localeCompare(right.name),
    )
    .slice(0, limit)
    .map((match) => tools[match.index]!);
};
