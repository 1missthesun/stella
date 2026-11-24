import type { Niche, ProblemPage } from "./types";

export const MAX_OVERLAP = 0.25;
export const WORDS = { min: 80, max: 260 };
export const MAX_AGE_DAYS = 365;

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

const BANNED: { pattern: RegExp; why: string; except?: string[] }[] = [
  { pattern: /(?<!\b(?:letting|estate|literary) )\bagents?\b/i, why: "say “tasks”, not “agents”" },
  { pattern: /\brahul\b/i, why: "no personal names" },
  { pattern: /\b(flights?|restaurants?)\b/i, why: "demo tasks are never flights or restaurants", except: ["watches"] },
  { pattern: /free forever|actually free|try stella/i, why: "banned price wording" },
  { pattern: /log ?in with claude|sign in with claude/i, why: "say “use your Claude plan”" },
  { pattern: /\b(revolutionary|game-?changer|supercharge|seamless(?! co-?op)(ly)?|effortless(ly)?|magic(al)?)\b/i, why: "no hype" },
  { pattern: /\bunlimited\b/i, why: "never imply unlimited use" },
  { pattern: /\bStella (?:won['’]t|can['’]t|cannot|can not|doesn['’]t|does not|will not|refuses?|stops short)\b/i, why: "no “Stella can't/won't” lines" },
  { pattern: /\b(?:copyright(?:ed)?|illegal(?:ly)?|legally|at your own risk|be careful|beware|disclaimer|not (?:legal|medical|financial|tax) advice)\b/i, why: "no cautions or disclaimers" },
  { pattern: /\bonly (?:for|with|use this on) (?:content|files|software|things) you own\b/i, why: "no cautions or disclaimers" },
  { pattern: /\bmake sure you have (?:permission|the right)/i, why: "no cautions or disclaimers" },
];

const JARGON =
  /`|\\\\?[A-Z][a-z]+\\\\|\s--?[a-z]{2,}|\b(?:sha-?\d+|md5|checksums?|hash(?:es|ed|ing)?|bytecode|opcodes?|disassembl\w+|assembly|hex(?:adecimal)?|offsets?|binary|binaries|compil\w+|obfuscat\w+|symlinks?|hard[- ]?links?|regex|cli|command[- ]line|terminal|powershell|json|xml|yaml|lua|ini files?|config(?:uration)? files?|registry|environment variables?|dependenc(?:y|ies)|repositor(?:y|ies)|api|sdk|jdk|runtime|parser|script extender|dll|ports?|trackers?|dht|peers?|protocols?|encryption keys?|sftp|ssh|root|admin rights|plugins?|frameworks?|loaders?|manifests?|metadata|endpoints?|headers?|payloads?|certificates?)\b/gi;

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

export function uniqueText(page: ProblemPage): string {
  return [
    page.answer,
    ...page.gets,
    page.prompt,
    page.costNote ?? "",
    ...page.faq.flatMap((item) => [item.q, item.a]),
    page.demo.ack,
    page.demo.task,
    ...page.demo.rows,
    page.demo.reply,
    ...(page.byHand ?? []),
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
  overlap: number;
  overlapWith: string | null;
  errors: string[];
};

const PHRASE_STOP = new Set(["a", "an", "the", "to", "how", "my", "your", "in", "on", "for", "of", "i", "do", "can", "you", "is", "it", "with"]);

export const phraseKey = (phrase: string) =>
  (phrase.toLowerCase().match(/[a-z0-9]+/g) ?? []).filter((w) => !PHRASE_STOP.has(w)).join(" ");

export function checkSearchOwnership(pages: ProblemPage[], others: { url: string; queries: string[] }[] = []): string[] {
  const owner = new Map<string, string>();
  const problems: string[] = [];
  const claim = (url: string, phrase: string) => {
    const key = phraseKey(phrase);
    if (!key) return;
    const other = owner.get(key);
    if (other && other !== url) problems.push(`${url}: search “${phrase}” is also targeted by ${other}`);
    else owner.set(key, url);
  };
  for (const other of others) for (const q of other.queries) claim(other.url, q);
  for (const page of pages.filter((p) => !p.draft)) for (const q of page.searchPhrases) claim(`/how/${page.niche}/${page.slug}`, q);
  return problems;
}

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

  global.push(...checkSearchOwnership(live));

  for (const niche of niches) {
    for (const section of niche.sections ?? []) {
      for (const slug of section.slugs) {
        if (!ids.has(`${niche.slug}/${slug}`)) global.push(`hub ${niche.slug}: section “${section.title}” lists unknown page “${slug}”`);
      }
    }
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
    need(page.lede.length >= 20 && page.lede.length <= 90, `lede is ${page.lede.length} characters (20–90)`);
    need(!/stella/i.test(page.lede), "lede names the product; the answer does that, with stella.sh");

    const key = words(page.searchPhrases[0] ?? "").filter((w) => !STOP.has(w));
    const h1 = new Set(words(page.h1));
    const hit = key.filter((w) => h1.has(w)).length;
    need(key.length > 0 && hit / key.length >= 0.5, `h1 shares only ${hit}/${key.length} words with “${page.searchPhrases[0]}”`);

    const answerWords = words(page.answer).length;
    need(answerWords >= 18 && answerWords <= 50, `answer is ${answerWords} words (18–50: one or two sentences)`);
    need(page.answer.includes("Stella (stella.sh)"), "answer must name “Stella (stella.sh)” on first mention");
    need(page.gets.length >= 2 && page.gets.length <= 4, "2 to 4 things you get");
    for (const line of page.gets) need(words(line).length <= 16, `“${line}” is ${words(line).length} words (max 16)`);
    need(page.faq.length >= 1 && page.faq.length <= 4, "1 to 4 questions");
    for (const item of page.faq) need(words(item.a).length <= 35, `the answer to “${item.q}” is ${words(item.a).length} words (max 35)`);

    const { ack, task, rows, reply } = page.demo;
    need(words(ack).length >= 3 && words(ack).length <= 20, `demo ack is ${words(ack).length} words (3–20)`);
    need(task.length <= 44, "demo task name over 44 characters");
    need(rows.length >= 2 && rows.length <= 4, "2 to 4 demo rows");
    for (const row of rows) need(words(row).length <= 9, `demo row “${row}” is ${words(row).length} words (max 9)`);
    need(words(reply).length >= 8 && words(reply).length <= 50, `demo reply is ${words(reply).length} words (8–50)`);

    const searched = new Set(words([page.title, page.h1, ...page.searchPhrases].join(" ")));
    const plain = (text: string, ok: Set<string>, where: string) => {
      for (const hit of text.matchAll(JARGON)) {
        const said = words(hit[0]);
        if (!said.length || !said.every((w) => searched.has(w) || ok.has(w))) errors.push(`“${hit[0].trim()}” is too technical for ${where}`);
      }
    };
    plain([page.lede, page.answer, ...page.gets, page.prompt, ack, task, ...rows, reply].join("\n"), new Set(), "a guide");
    for (const item of page.faq) plain(item.a, new Set(words(item.q)), "an answer");

    need((page.byHand ?? []).length <= 5, "at most 5 by-hand lines");
    for (const line of page.byHand ?? []) need(words(line).length <= 28, `by-hand line “${line.slice(0, 40)}…” is ${words(line).length} words (max 28)`);
    need(words(page.prompt).length >= 8, "prompt under 8 words: make it specific enough to paste");
    need(page.platforms.length > 0, "list the platforms");

    need(page.related.length >= 2, "link at least 2 related problems");
    for (const rel of page.related) {
      need(rel !== id, "a page can't be related to itself");
      need(ids.has(rel), `related page “${rel}” doesn't exist (or is a draft)`);
    }

    need(ISO_DATE.test(page.lastChecked), "lastChecked must be YYYY-MM-DD");
    const age = (today.getTime() - Date.parse(page.lastChecked)) / 86_400_000;
    need(age >= -1, "lastChecked is in the future");
    need(age <= MAX_AGE_DAYS, `facts last checked ${Math.floor(age)} days ago: recheck and update lastChecked`);

    const text = [page.title, page.h1, page.description, page.lede, uniqueText(page)].join(" ");
    for (const rule of BANNED) {
      if (rule.except?.includes(page.niche)) continue;
      const match = text.match(rule.pattern);
      if (match) errors.push(`“${match[0]}”: ${rule.why}`);
    }

    const count = words(uniqueText(page)).length;
    need(count >= WORDS.min && count <= WORDS.max, `${count} words (${WORDS.min}–${WORDS.max})`);

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

export function assertProblemPages(pages: ProblemPage[], niches: Niche[]) {
  const { reports, errors } = checkProblemPages(pages, niches);
  const lines = [
    ...errors,
    ...reports.flatMap((report) => report.errors.map((error) => `${report.page}: ${error}`)),
  ];
  if (lines.length) {
    throw new Error(`Problem pages failed the quality gate:\n  - ${lines.join("\n  - ")}`);
  }
}
