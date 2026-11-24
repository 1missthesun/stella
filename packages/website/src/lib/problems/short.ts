import type { Faq, Platform, ProblemPage } from "./types";

/**
 * A guide, for people who aren't technical: the outcome they want, in their
 * words, and that they just ask Stella. No tutorials, no jargon (a tool's name
 * only where it's what people search for). The gate enforces the length and
 * the plain words.
 */
export type ShortGuide = Omit<ProblemPage, "faq" | "platforms"> & {
  faq: [q: string, a: string][];
  platforms?: Platform[];
};

export function shortGuide({ faq, platforms, ...page }: ShortGuide): ProblemPage {
  return {
    ...page,
    platforms: platforms ?? ["windows", "mac", "linux"],
    faq: faq.map(([q, a]): Faq => ({ q, a })),
  };
}
