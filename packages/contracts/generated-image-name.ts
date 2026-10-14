const MAX_TITLE_CHARS = 48;
const MAX_TITLE_WORDS = 8;
const FALLBACK_TITLE = "Generated image";
const TRAILING_FILLER = new Set([
  "a",
  "an",
  "and",
  "at",
  "by",
  "for",
  "from",
  "in",
  "of",
  "on",
  "or",
  "the",
  "to",
  "with",
]);

const titleFromPrompt = (prompt: string | undefined): string => {
  const words = (prompt ?? "")
    .replace(/[\\/:*?"<>|#%{}^~[\]`\u0000-\u001f]+/g, " ")
    .split(/\s+/)
    .filter(Boolean);
  const kept: string[] = [];
  let length = 0;
  for (const word of words.slice(0, MAX_TITLE_WORDS)) {
    length += (kept.length ? 1 : 0) + word.length;
    if (length > MAX_TITLE_CHARS) break;
    kept.push(word);
  }
  while (
    kept.length > 1 &&
    TRAILING_FILLER.has(
      kept
        .at(-1)!
        .replace(/[^\p{L}]+/gu, "")
        .toLowerCase(),
    )
  ) {
    kept.pop();
  }
  let title = kept.join(" ");
  if (!title && words[0]) title = words[0].slice(0, MAX_TITLE_CHARS);
  title = title.replace(/[\s.,;:!?'()\-–—]+$/u, "").replace(/^[\s.]+/u, "");
  return title
    ? title.charAt(0).toUpperCase() + title.slice(1)
    : FALLBACK_TITLE;
};

export const generatedImageFileName = (args: {
  prompt: string | undefined;
  index: number;
  count: number;
  extension: string;
}): string => {
  const number = args.count > 1 ? ` ${args.index + 1}` : "";
  const extension = args.extension.replace(/^\.+/, "").toLowerCase() || "png";
  return `${titleFromPrompt(args.prompt)}${number}.${extension}`;
};
