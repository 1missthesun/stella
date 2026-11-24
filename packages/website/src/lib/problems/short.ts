import type { Faq, Platform, ProblemPage } from "./types";

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
