// Runs the problem-page quality gate and prints a table: words of each page's
// own content, its closest neighbour by shared phrasing, and any failures.
// `next build` runs the same gate; this is the quick version while writing.
//   bun scripts/check-problem-pages.ts
import { ANSWER_PAGES } from "../src/lib/answers";
import { FIX_PAGES } from "../src/lib/fix-pages";
import { MAX_OVERLAP, WORDS, checkProblemPages, checkSearchOwnership } from "../src/lib/problems/gate";
import { MOVED_FIX_PAGES } from "../src/lib/problems/moved-fix";
import { NICHES } from "../src/lib/problems/niches";
import { ALL_PROBLEM_PAGES } from "../src/lib/problems/pages";

const pages = ALL_PROBLEM_PAGES;
const { reports, errors } = checkProblemPages(pages, NICHES);
console.log(`${WORDS.min}–${WORDS.max} words, max ${MAX_OVERLAP * 100}% shared phrasing\n`);
for (const r of reports) {
  console.log(
    `${r.errors.length ? "FAIL" : "ok  "} ${r.page.padEnd(48)} ${String(r.words).padStart(5)} words  ${Math.round(r.overlap * 100)}% ~ ${r.overlapWith ?? "-"}`,
  );
  for (const e of r.errors) console.log(`       - ${e}`);
}
// Searches already taken by /ai answer pages and live /fix pages (the build checks /how alone).
const others = [
  ...ANSWER_PAGES.map((page) => ({ url: `/ai/${page.slug}`, queries: page.queries })),
  ...FIX_PAGES.filter((page) => !MOVED_FIX_PAGES[page.slug]).map((page) => ({ url: `/fix/${page.slug}`, queries: page.symptoms })),
];
const howOnly = new Set(checkSearchOwnership(pages));
errors.push(...checkSearchOwnership(pages, others).filter((e) => !howOnly.has(e)));
for (const e of errors) console.log(`FAIL ${e}`);
if (errors.length || reports.some((r) => r.errors.length)) process.exit(1);
