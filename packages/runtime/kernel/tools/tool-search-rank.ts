/**
 * Ported from Pi (https://github.com/earendil-works/pi), MIT License,
 * Copyright (c) 2025 Mario Zechner.
 */

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
const NAME_WEIGHT = 3;
const MIN_NAME_SUBSTRING = 4;
const MAX_SCHEMA_DEPTH = 6;
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

export const tokenizeSearchText = (text: string): string[] => {
  const normalized = text
    .normalize("NFC")
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2")
    .toLowerCase()
    .replace(/[^\p{L}\p{M}\p{N}]+/gu, " ");
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

const normalizeName = (name: string): string =>
  name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_$]/g, "_");

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === "object" && !Array.isArray(value);

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
