import { mainMemoryCapNote } from "./memory-layout.js";
import { redactMemoryText } from "./redaction.js";

const unicodeCodePointLength = (text: string): number => Array.from(text).length;

const stripInjectedHtmlComments = (text: string): string =>
  text
    .replace(/<!--[\s\S]*?-->/gu, "")
    .replace(/<!--[\s\S]*$/u, "")
    .replace(/\n{3,}/gu, "\n\n")
    .trim();

const truncationMarker = (chars: number): string =>
  `\n[Truncated here. ${mainMemoryCapNote(chars) ?? ""}]`;

const truncateUnicodeAtLineBoundary = (
  text: string,
  maxChars: number,
): string => {
  const chars = unicodeCodePointLength(text);
  if (chars <= maxChars) return text;
  const marker = truncationMarker(chars);
  const markerChars = unicodeCodePointLength(marker);
  if (maxChars < markerChars) return "";
  const prefixBudget = maxChars - markerChars;
  let prefix = "";
  for (const match of text.matchAll(/[^\r\n]*(?:\r\n|\r|\n)/gu)) {
    const candidate = `${prefix}${match[0]}`;
    if (unicodeCodePointLength(candidate) > prefixBudget) break;
    prefix = candidate;
  }
  if (!prefix) {
    prefix = [...text].slice(0, prefixBudget).join("");
  }
  return `${prefix.trimEnd()}${marker}`;
};

export const residentMemoryChars = (raw: string): number =>
  unicodeCodePointLength(redactMemoryText(stripInjectedHtmlComments(raw)));

export const shapeResidentMemoryDoc = (
  raw: string,
  maxChars: number,
): string | undefined => {
  const content = stripInjectedHtmlComments(raw);
  if (!content) return undefined;
  return truncateUnicodeAtLineBoundary(redactMemoryText(content), maxChars) || undefined;
};
