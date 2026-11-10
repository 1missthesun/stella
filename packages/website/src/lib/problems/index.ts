import { PRICE_LINE, TRIAL_LINE, plainText, softwareApplicationJsonLd } from "@/lib/answers";
import { assertProblemPages } from "./gate";
import { NICHES, getNiche } from "./niches";
import { ALL_PROBLEM_PAGES } from "./pages";
import type { Faq, Niche, Platform, ProblemPage, Proof } from "./types";

export type { Niche, ProblemPage, Proof } from "./types";
export { NICHES, getNiche };

const ALL_PAGES = ALL_PROBLEM_PAGES;

export const HOW_INDEX_PATH = "/how";

let checked: ProblemPage[] | null = null;

/** Published pages, after the quality gate. Throws (failing the build) if any page fails. */
export function publishedProblemPages(): ProblemPage[] {
  if (!checked) {
    assertProblemPages(ALL_PAGES, NICHES);
    checked = ALL_PAGES.filter((page) => !page.draft);
  }
  return checked;
}

/** Niches with at least one published page, in hub order. */
export function publishedNiches(): Niche[] {
  const pages = publishedProblemPages();
  return NICHES.filter((niche) => pages.some((page) => page.niche === niche.slug));
}

export function nichePages(niche: string): ProblemPage[] {
  return publishedProblemPages().filter((page) => page.niche === niche);
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

/** Related pages first, then the rest of the niche, so neighbours always link to each other. */
export function neighbours(page: ProblemPage, limit = 6): ProblemPage[] {
  const out: ProblemPage[] = [];
  const add = (other: ProblemPage | undefined) => {
    if (other && other !== page && !out.includes(other)) out.push(other);
  };
  page.related.forEach((id) => add(getProblemById(id)));
  nichePages(page.niche).forEach(add);
  return out.slice(0, limit);
}

export const proofLabel = (page: ProblemPage) =>
  page.proof.kind === "video" ? "Video proof" : page.proof.kind === "shots" ? "Screenshot proof" : "Steps only";

export const PLATFORM_NAMES: Record<Platform, string> = {
  windows: "Windows",
  mac: "Mac",
  linux: "Linux",
};

/** Asked on every problem page; not counted as the page's own content. */
export function sharedFaq(page: ProblemPage): Faq[] {
  const where = page.platforms.map((p) => PLATFORM_NAMES[p]).join(", ").replace(/, ([^,]*)$/, " and $1");
  return [
    {
      q: "Is Stella free for this?",
      a:
        page.costNote ??
        `Yes. ${PRICE_LINE} Sign in with your ChatGPT plan, or use your Claude plan through Claude Code, and this task costs nothing extra. ${TRIAL_LINE}`,
    },
    {
      q: "Can I control what Stella changes on my computer?",
      a: `Yes. Stella works on ${where} with your own files and shows each step in the chat, so you can watch it and stop it at any point. Tell it what it may not do, as the prompts on these pages do (“don't delete anything without asking”), and it waits for your go-ahead. It also refuses commands that would wipe a whole disk, your home folder or system folders.`,
    },
  ];
}

export const captionsPath = (page: ProblemPage) =>
  page.proof.kind === "video" ? (page.proof.video.captions ?? `${problemPath(page)}/captions.vtt`) : null;

const vttTime = (seconds: number) => {
  const ms = Math.round(seconds * 1000);
  const h = Math.floor(ms / 3_600_000);
  const m = Math.floor((ms % 3_600_000) / 60_000);
  const s = Math.floor((ms % 60_000) / 1000);
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}.${String(ms % 1000).padStart(3, "0")}`;
};

/** WebVTT built from a video proof's transcript moments: each runs until the next. */
export function captionsVtt(page: ProblemPage): string | null {
  const proof = page.proof;
  if (proof.kind !== "video") return null;
  const cues = proof.moments.map((moment, i) => {
    const end = Math.min(proof.moments[i + 1]?.at ?? proof.video.duration, moment.at + 8);
    return `${i + 1}\n${vttTime(moment.at)} --> ${vttTime(Math.max(end, moment.at + 1))}\n${moment.text}`;
  });
  return `WEBVTT\n\n${cues.join("\n\n")}\n`;
}

export const formatDate = (iso: string) =>
  new Date(`${iso}T12:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });

export const formatDuration = (seconds: number) => {
  const m = Math.floor(seconds / 60);
  const s = Math.round(seconds % 60);
  return m ? `${m} min ${String(s).padStart(2, "0")} s` : `${s} s`;
};

const isoDuration = (seconds: number) => `PT${Math.floor(seconds / 60)}M${Math.round(seconds % 60)}S`;

function videoJsonLd(page: ProblemPage, proof: Extract<Proof, { kind: "video" }>, url: string, site: URL) {
  const abs = (src: string) => new URL(src, site).href;
  return {
    "@context": "https://schema.org",
    "@type": "VideoObject",
    "@id": `${url}#proof`,
    name: `Stella: ${page.h1}`,
    description: `${proof.result} Recorded ${formatDate(proof.recordedOn)} on ${proof.platform} with ${proof.model}.`,
    thumbnailUrl: [abs(proof.video.poster)],
    uploadDate: `${proof.recordedOn}T12:00:00Z`,
    duration: isoDuration(proof.video.duration),
    contentUrl: abs(proof.video.src),
    embedUrl: url,
    transcript: proof.moments.map((m) => m.text).join(" "),
    publisher: { "@id": `${site.origin}/#organization` },
  };
}

/** BreadcrumbList, FAQPage, VideoObject (when there's a recording) and SoftwareApplication. */
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
    ...(page.proof.kind === "video" ? [videoJsonLd(page, page.proof, url, site)] : []),
    softwareApplicationJsonLd(site, page.description),
  ];
}
