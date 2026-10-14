export function detectLineEnding(content: string): "\r\n" | "\n" {
  const crlfIdx = content.indexOf("\r\n");
  const lfIdx = content.indexOf("\n");
  if (lfIdx === -1) return "\n";
  if (crlfIdx === -1) return "\n";
  return crlfIdx < lfIdx ? "\r\n" : "\n";
}

export function normalizeToLF(text: string): string {
  return text.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
}

export function restoreLineEndings(text: string, ending: "\r\n" | "\n"): string {
  return ending === "\r\n" ? text.replace(/\n/g, "\r\n") : text;
}

const FUZZY_ASCII_LINE = /^[\x00-\x7f]*$/;
const FUZZY_CLUSTER = /\P{M}\p{M}*|\p{M}+/gu;

const normalizeFuzzyCluster = (cluster: string): string =>
  cluster
    .normalize("NFKC")
    .replace(/[\u2018\u2019\u201A\u201B]/g, "'")
    .replace(/[\u201C\u201D\u201E\u201F]/g, '"')
    .replace(/[\u2010\u2011\u2012\u2013\u2014\u2015\u2212]/g, "-")
    .replace(/[\u00A0\u2002-\u200A\u202F\u205F\u3000]/g, " ");

interface FuzzyNormalized {
  text: string;
  startMap: Int32Array;
  endMap: Int32Array;
}

function normalizeForFuzzyMatchWithMap(text: string): FuzzyNormalized {
  const parts: string[] = [];
  const starts: number[] = [];
  const ends: number[] = [];
  let lineOffset = 0;
  let previousStrippedFrom = 0;
  const lines = text.split("\n");
  lines.forEach((line, lineIndex) => {
    if (lineIndex > 0) {
      parts.push("\n");
      starts.push(lineOffset - 1);
      ends.push(previousStrippedFrom);
    }
    let lineText: string;
    const lineMap: number[] = [];
    if (FUZZY_ASCII_LINE.test(line)) {
      lineText = line;
      for (let index = 0; index < line.length; index++) {
        lineMap.push(lineOffset + index);
      }
    } else {
      const pieces: string[] = [];
      for (const match of line.matchAll(FUZZY_CLUSTER)) {
        const normalized = normalizeFuzzyCluster(match[0]);
        pieces.push(normalized);
        for (let index = 0; index < normalized.length; index++) {
          lineMap.push(index === 0 ? lineOffset + (match.index ?? 0) : -1);
        }
      }
      lineText = pieces.join("");
    }
    let kept = lineText.trimEnd().length;
    while (kept < lineText.length && lineMap[kept] === -1) kept++;
    previousStrippedFrom =
      kept < lineText.length ? lineMap[kept]! : lineOffset + line.length;
    parts.push(lineText.slice(0, kept));
    for (let index = 0; index < kept; index++) {
      starts.push(lineMap[index]!);
      ends.push(lineMap[index]!);
    }
    lineOffset += line.length + 1;
  });
  starts.push(text.length);
  ends.push(previousStrippedFrom);
  return {
    text: parts.join(""),
    startMap: Int32Array.from(starts),
    endMap: Int32Array.from(ends),
  };
}

function normalizeForFuzzyMatch(text: string): string {
  return normalizeForFuzzyMatchWithMap(text).text;
}

export interface FuzzyMatchResult {
  found: boolean;
  index: number;
  matchLength: number;
  usedFuzzyMatch: boolean;
  occurrences: number;
  locations: number[];
  leading: string;
  trailing: string;
}

const MAX_REPORTED_LOCATIONS = 5;

const findOccurrences = (haystack: string, needle: string): number[] => {
  const found: number[] = [];
  let cursor = 0;
  while (cursor <= haystack.length - needle.length) {
    const index = haystack.indexOf(needle, cursor);
    if (index === -1) break;
    found.push(index);
    cursor = index + Math.max(1, needle.length);
  }
  return found;
};

export function fuzzyFindText(content: string, oldText: string): FuzzyMatchResult {
  const notFound: FuzzyMatchResult = {
    found: false,
    index: -1,
    matchLength: 0,
    usedFuzzyMatch: false,
    occurrences: 0,
    locations: [],
    leading: "",
    trailing: "",
  };
  const exact = oldText.length > 0 ? findOccurrences(content, oldText) : [];
  if (exact.length > 0) {
    return {
      found: true,
      index: exact[0]!,
      matchLength: oldText.length,
      usedFuzzyMatch: false,
      occurrences: exact.length,
      locations: exact.slice(0, MAX_REPORTED_LOCATIONS),
      leading: "",
      trailing: "",
    };
  }
  const fuzzyOldText = normalizeForFuzzyMatch(oldText);
  if (!fuzzyOldText) return notFound;
  const fuzzy = normalizeForFuzzyMatchWithMap(content);
  const matches = findOccurrences(fuzzy.text, fuzzyOldText);
  if (matches.length === 0) return notFound;
  const toOriginal = (normalizedStart: number) => {
    const normalizedEnd = normalizedStart + fuzzyOldText.length;
    let start = normalizedStart;
    while (start > 0 && fuzzy.startMap[start] === -1) start--;
    let end = normalizedEnd;
    while (end < fuzzy.text.length && fuzzy.endMap[end] === -1) end++;
    const originalStart = fuzzy.startMap[start]!;
    const originalEnd = Math.max(originalStart, fuzzy.endMap[end]!);
    return {
      index: originalStart,
      matchLength: originalEnd - originalStart,
      leading: fuzzy.text.slice(start, normalizedStart),
      trailing: fuzzy.text.slice(normalizedEnd, end),
    };
  };
  return {
    found: true,
    ...toOriginal(matches[0]!),
    usedFuzzyMatch: true,
    occurrences: matches.length,
    locations: matches
      .slice(0, MAX_REPORTED_LOCATIONS)
      .map((match) => toOriginal(match).index),
  };
}

export function stripBom(content: string): { bom: string; text: string } {
  return content.startsWith("\uFEFF")
    ? { bom: "\uFEFF", text: content.slice(1) }
    : { bom: "", text: content };
}
