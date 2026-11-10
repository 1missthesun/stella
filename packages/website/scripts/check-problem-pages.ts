// Runs the problem-page quality gate and prints a table: words of each page's
// own content, its closest neighbour by shared phrasing, and any failures.
// `next build` runs the same gate; this is the quick version while writing.
//   bun scripts/check-problem-pages.ts
import { MAX_OVERLAP, MIN_UNIQUE_WORDS, checkProblemPages } from "../src/lib/problems/gate";
import { NICHES } from "../src/lib/problems/niches";
import { ALL_PROBLEM_PAGES } from "../src/lib/problems/pages";

const pages = ALL_PROBLEM_PAGES;
const { reports, errors } = checkProblemPages(pages, NICHES);
console.log(`min ${MIN_UNIQUE_WORDS} words, max ${MAX_OVERLAP * 100}% shared phrasing\n`);
for (const r of reports) {
  const proof = pages.find((p) => `${p.niche}/${p.slug}` === r.page)!.proof.kind;
  console.log(
    `${r.errors.length ? "FAIL" : "ok  "} ${r.page.padEnd(48)} ${String(r.words).padStart(5)} words  ${proof.padEnd(10)}  ${Math.round(r.overlap * 100)}% ~ ${r.overlapWith ?? "-"}`,
  );
  for (const e of r.errors) console.log(`       - ${e}`);
}
for (const e of errors) console.log(`FAIL ${e}`);
if (errors.length || reports.some((r) => r.errors.length)) process.exit(1);
