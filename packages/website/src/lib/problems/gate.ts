import type { Niche, ProblemPage } from "./types";

/**
 * The quality gate. Every published problem page passes through here when the
 * site builds (the routes, sitemap and llms.txt all read pages through
 * `publishedProblemPages()`), so a thin, duplicated or unproven page fails
 * `next build` with a list of what to fix. Mark a page `draft: true` to keep
 * it out of the site while it's being written.
 */

/** Words of page-specific content (answer, Stella steps, prompt, manual steps, limits, FAQ). */
export const MIN_UNIQUE_WORDS = 450;
/** Share of a page's 5-word phrases that may also appear in any one other page. */
export const MAX_OVERLAP = 0.25;
/** Published pages allowed without a proof run at once. */
export const MAX_STEPS_ONLY = 3;
/** A page whose facts weren't checked within this many days fails. */
export const MAX_AGE_DAYS = 365;

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/** Copy rules from the brief, enforced so they hold at a few hundred pages. */
const BANNED: { pattern: RegExp; why: string }[] = [
  { pattern: /\bagents?\b/i, why: "say “tasks”, not “agents”" },
  { pattern: /\brahul\b/i, why: "no personal names" },
  { pattern: /\b(flights?|restaurants?)\b/i, why: "demo tasks are never flights or restaurants" },
  { pattern: /free forever|actually free|try stella/i, why: "banned price wording" },
  { pattern: /log ?in with claude|sign in with claude/i, why: "say “use your Claude plan”" },
  { pattern: /\b(revolutionary|game-?changer|supercharge|seamless(ly)?|effortless(ly)?|magic(al)?)\b/i, why: "no hype" },
  { pattern: /\bunlimited\b/i, why: "never imply unlimited use" },
];

const STOP = new Set(
  "a an the and or of on in to for with your you my is it how do i can what why at by from into this that be".split(" "),
);

const words = (text: string) =>
  text
    .toLowerCase()
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/[`*_]/g, "")
    .split(/[^a-z0-9.+#']+/)
    .filter(Boolean);

/** The text that is this page's own: what the gate counts and compares. */
export function uniqueText(page: ProblemPage): string {
  return [
    page.answer,
    ...page.stellaSteps,
    page.prompt,
    ...page.manualSteps.flatMap((step) => [step.title, step.body]),
    ...page.limits,
    ...page.faq.flatMap((item) => [item.q, item.a]),
  ].join(" ");
}

function shingles(text: string, n = 5): Set<string> {
  const w = words(text);
  const out = new Set<string>();
  for (let i = 0; i + n <= w.length; i++) out.add(w.slice(i, i + n).join(" "));
  return out;
}

export type GateReport = {
  page: string;
  words: number;
  /** Highest phrase overlap with another page, 0–1, and which page. */
  overlap: number;
  overlapWith: string | null;
  errors: string[];
};

export function checkProblemPages(
  pages: ProblemPage[],
  niches: Niche[],
  today = new Date(),
): { reports: GateReport[]; errors: string[] } {
  const live = pages.filter((page) => !page.draft);
  const ids = new Set(live.map((page) => `${page.niche}/${page.slug}`));
  const nicheSlugs = new Set(niches.map((niche) => niche.slug));
  const global: string[] = [];

  const seen = new Map<string, string>();
  for (const page of live) {
    const id = `${page.niche}/${page.slug}`;
    for (const [field, value] of [
      ["title", page.title],
      ["h1", page.h1],
      ["description", page.description],
      ["prompt", page.prompt],
    ] as const) {
      const key = `${field}:${value.toLowerCase()}`;
      const other = seen.get(key);
      if (other) global.push(`${id}: same ${field} as ${other}`);
      else seen.set(key, id);
    }
  }

  const stepsOnly = live.filter((page) => page.proof.kind === "steps-only");
  if (stepsOnly.length > MAX_STEPS_ONLY) {
    global.push(
      `${stepsOnly.length} published pages are steps-only (max ${MAX_STEPS_ONLY}): record proofs or mark some as drafts.`,
    );
  }

  const prints = new Map(live.map((page) => [`${page.niche}/${page.slug}`, shingles(uniqueText(page))]));

  const reports = live.map((page): GateReport => {
    const id = `${page.niche}/${page.slug}`;
    const errors: string[] = [];
    const need = (ok: unknown, message: string) => {
      if (!ok) errors.push(message);
    };

    need(SLUG.test(page.slug), "slug must be lowercase-hyphenated");
    need(nicheSlugs.has(page.niche), `unknown niche “${page.niche}”`);
    need(page.searchPhrases.length >= 3, "list at least 3 search phrases");
    need(page.title.length <= 65, `title is ${page.title.length} characters (max 65)`);
    need(
      page.description.length >= 110 && page.description.length <= 170,
      `description is ${page.description.length} characters (110–170)`,
    );
    need(page.short.length <= 48, "short label over 48 characters");

    // The H1 is the search in the reader's words: it must share most of the
    // main phrase's meaningful words.
    const key = words(page.searchPhrases[0] ?? "").filter((w) => !STOP.has(w));
    const h1 = new Set(words(page.h1));
    const hit = key.filter((w) => h1.has(w)).length;
    need(key.length > 0 && hit / key.length >= 0.5, `h1 shares only ${hit}/${key.length} words with “${page.searchPhrases[0]}”`);

    const answerWords = words(page.answer).length;
    need(answerWords >= 30 && answerWords <= 110, `answer is ${answerWords} words (30–110: two or three sentences)`);
    need(page.answer.includes("Stella (stella.sh)"), "answer must name “Stella (stella.sh)” on first mention");
    need(page.stellaSteps.length >= 3, "at least 3 Stella steps");
    need(words(page.prompt).length >= 12, "prompt under 12 words: make it specific enough to paste");
    need(page.manualSteps.length >= 3, "at least 3 manual steps");
    for (const step of page.manualSteps) {
      need(words(step.body).length >= 12, `manual step “${step.title}” is too thin`);
    }
    need(page.limits.length >= 2, "at least 2 honest limits");
    need(page.faq.length >= 3, "at least 3 FAQ entries");
    need(page.platforms.length > 0, "list the platforms");
    need(page.sources.length >= 1, "cite at least one source");
    for (const source of page.sources) need(/^https:\/\//.test(source.href), `source ${source.href} must be https`);

    need(page.related.length >= 2, "link at least 2 related problems");
    for (const rel of page.related) {
      need(rel !== id, "a page can't be related to itself");
      need(ids.has(rel), `related page “${rel}” doesn't exist (or is a draft)`);
    }

    need(ISO_DATE.test(page.lastChecked), "lastChecked must be YYYY-MM-DD");
    const age = (today.getTime() - Date.parse(page.lastChecked)) / 86_400_000;
    need(age >= -1, "lastChecked is in the future");
    need(age <= MAX_AGE_DAYS, `facts last checked ${Math.floor(age)} days ago: recheck and update lastChecked`);

    const proof = page.proof;
    if (proof.kind === "steps-only") {
      need(proof.reason.length >= 20, "steps-only pages must say why there's no proof yet");
    } else {
      need(ISO_DATE.test(proof.recordedOn), "proof.recordedOn must be YYYY-MM-DD");
      need(proof.platform && proof.model, "proof must name its platform and model");
      need(words(proof.result).length >= 8, "proof.result must say what the run produced");
      if (proof.kind === "video") {
        need(/\.mp4$/.test(proof.video.src), "video must be an MP4");
        need(proof.video.poster, "video needs a poster");
        need(!proof.video.captions || /\.vtt$/.test(proof.video.captions), "captions must be WebVTT");
        need(proof.moments.length >= 3, "video needs at least 3 transcript moments");
        need(
          proof.moments.every((m, i, all) => m.at >= 0 && m.at <= proof.video.duration && (i === 0 || m.at > all[i - 1].at)),
          "transcript moments must be in order and inside the video",
        );
      } else {
        need(proof.shots.length >= 3, "a screenshot proof needs at least 3 shots");
      }
      for (const shot of proof.shots ?? []) need(shot.alt.length >= 10, `shot ${shot.src} needs real alt text`);
    }

    const text = [page.title, page.h1, page.description, uniqueText(page)].join(" ");
    for (const rule of BANNED) {
      const match = text.match(rule.pattern);
      if (match) errors.push(`“${match[0]}”: ${rule.why}`);
    }

    const count = words(uniqueText(page)).length;
    need(count >= MIN_UNIQUE_WORDS, `${count} words of its own content (min ${MIN_UNIQUE_WORDS})`);

    let overlap = 0;
    let overlapWith: string | null = null;
    const mine = prints.get(id)!;
    for (const [other, theirs] of prints) {
      if (other === id || mine.size === 0) continue;
      let shared = 0;
      for (const s of mine) if (theirs.has(s)) shared++;
      const share = shared / mine.size;
      if (share > overlap) {
        overlap = share;
        overlapWith = other;
      }
    }
    need(
      overlap <= MAX_OVERLAP,
      `${Math.round(overlap * 100)}% of its phrasing is also on ${overlapWith} (max ${MAX_OVERLAP * 100}%)`,
    );

    return { page: id, words: count, overlap, overlapWith, errors };
  });

  return { reports, errors: global };
}

/** Throws with every failure listed, so `next build` stops on a bad page. */
export function assertProblemPages(pages: ProblemPage[], niches: Niche[]) {
  const { reports, errors } = checkProblemPages(pages, niches);
  const lines = [
    ...errors,
    ...reports.flatMap((report) => report.errors.map((error) => `${report.page}: ${error}`)),
  ];
  for (const niche of niches) {
    if (!pages.some((page) => page.niche === niche.slug && !page.draft)) {
      lines.push(`niche “${niche.slug}” has no published pages: remove it or add one`);
    }
  }
  if (lines.length) {
    throw new Error(`Problem pages failed the quality gate:\n  - ${lines.join("\n  - ")}`);
  }
}
