import { PRICE_LINE, plainText, softwareApplicationJsonLd } from "@/lib/answers";
import { demoFrom, type DemoStep } from "@/lib/demo";
import { assertProblemPages } from "./gate";
import { NICHES, getNiche } from "./niches";
import { ALL_PROBLEM_PAGES } from "./pages";
import type { Faq, Niche, Platform, ProblemPage } from "./types";

export type { Niche, ProblemPage } from "./types";
export { NICHES, getNiche };

const ALL_PAGES = ALL_PROBLEM_PAGES;

export const HOW_INDEX_PATH = "/how";

let checked: ProblemPage[] | null = null;

export function publishedProblemPages(): ProblemPage[] {
  if (!checked) {
    assertProblemPages(ALL_PAGES, NICHES);
    checked = ALL_PAGES.filter((page) => !page.draft);
  }
  return checked;
}

export function publishedNiches(): Niche[] {
  const pages = publishedProblemPages();
  return NICHES.filter((niche) => pages.some((page) => page.niche === niche.slug));
}

export function nichePages(niche: string): ProblemPage[] {
  return publishedProblemPages().filter((page) => page.niche === niche);
}

export function nicheSections(niche: Niche): { title?: string; pages: ProblemPage[] }[] {
  const pages = nichePages(niche.slug);
  if (!niche.sections?.length) return [{ pages }];
  const bySlug = new Map(pages.map((page) => [page.slug, page]));
  const placed = new Set<string>();
  const groups: { title?: string; pages: ProblemPage[] }[] = niche.sections.map((section) => ({
    title: section.title,
    pages: section.slugs.flatMap((slug) => {
      const page = bySlug.get(slug);
      if (!page || placed.has(slug)) return [];
      placed.add(slug);
      return [page];
    }),
  }));
  const rest = pages.filter((page) => !placed.has(page.slug));
  if (rest.length) groups.push({ title: "Other guides.", pages: rest });
  return groups.filter((group) => group.pages.length);
}

export function pageDemo(page: ProblemPage): DemoStep[] {
  return demoFrom({ prompt: page.prompt, ...page.demo });
}

export function getProblemPage(niche: string, slug: string) {
  return publishedProblemPages().find((page) => page.niche === niche && page.slug === slug);
}

export const problemId = (page: ProblemPage) => `${page.niche}/${page.slug}`;
export const problemPath = (page: ProblemPage) => `${HOW_INDEX_PATH}/${page.niche}/${page.slug}`;
export const nichePath = (niche: Niche | string) =>
  `${HOW_INDEX_PATH}/${typeof niche === "string" ? niche : niche.slug}`;

export function getProblemById(id: string) {
  const [niche, slug] = id.split("/");
  return getProblemPage(niche, slug);
}

export function neighbours(page: ProblemPage, limit = 6): ProblemPage[] {
  const out: ProblemPage[] = [];
  const add = (other: ProblemPage | undefined) => {
    if (other && other !== page && !out.includes(other)) out.push(other);
  };
  page.related.forEach((id) => add(getProblemById(id)));
  nichePages(page.niche).forEach(add);
  return out.slice(0, limit);
}

export const GUIDE_LABEL = "Just ask Stella";

export const FREE_LINE = "Free with the plan you already have.";

export const PLATFORM_NAMES: Record<Platform, string> = {
  windows: "Windows",
  mac: "Mac",
  linux: "Linux",
};

export function sharedFaq(page: ProblemPage): Faq[] {
  return [{ q: "Is Stella free?", a: page.costNote ?? `Yes. ${PRICE_LINE}` }];
}

export const formatDate = (iso: string) =>
  new Date(`${iso}T12:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });

export function problemJsonLd(page: ProblemPage, site: URL) {
  const niche = getNiche(page.niche)!;
  const url = new URL(problemPath(page), site).href;
  const faq = [...page.faq, ...sharedFaq(page)];
  return [
    {
      "@context": "https://schema.org",
      "@type": "BreadcrumbList",
      itemListElement: [
        { "@type": "ListItem", position: 1, name: "Stella", item: site.origin },
        { "@type": "ListItem", position: 2, name: "How-to", item: new URL(HOW_INDEX_PATH, site).href },
        { "@type": "ListItem", position: 3, name: niche.name, item: new URL(nichePath(niche), site).href },
        { "@type": "ListItem", position: 4, name: page.short, item: url },
      ],
    },
    {
      "@context": "https://schema.org",
      "@type": "FAQPage",
      "@id": `${url}#faq`,
      url,
      mainEntity: faq.map((item) => ({
        "@type": "Question",
        name: item.q,
        acceptedAnswer: { "@type": "Answer", text: plainText(item.a) },
      })),
    },
    softwareApplicationJsonLd(site, page.description),
  ];
}
