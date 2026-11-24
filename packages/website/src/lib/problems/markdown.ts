import { PRICE_LINE } from "@/lib/answers";
import { demoText } from "@/lib/demo";
import { getSiteUrl } from "@/lib/site-url";
import {
  HOW_INDEX_PATH,
  PLATFORM_NAMES,
  getNiche,
  neighbours,
  nichePages,
  nicheSections,
  nichePath,
  pageDemo,
  problemPath,
  publishedNiches,
  sharedFaq,
  type ProblemPage,
} from ".";

const abs = (path: string) => new URL(path, getSiteUrl()).href;
const absLinks = (text: string) => text.replace(/\]\(\//g, `](${getSiteUrl().origin}/`);

/** The body of a problem page, headings starting at `level`. */
export function problemBody(page: ProblemPage, level = 2): string {
  const h = "#".repeat(level);
  const lines = [page.answer, "", `${h} What you get`, "", ...page.gets.map((line) => `- ${line}`), "", `${h} Ask Stella`, "", `> ${page.prompt}`, ""];
  lines.push(`${h} An example chat`, "", demoText(pageDemo(page)), "");
  lines.push(`Works on ${page.platforms.map((p) => PLATFORM_NAMES[p]).join(", ")}.`, "", `${h} Questions`, "");
  for (const item of [...page.faq, ...sharedFaq(page)]) lines.push(`**${item.q}**`, item.a, "");
  if (page.byHand?.length) lines.push(`${h} By hand`, "", ...page.byHand.map((line, i) => `${i + 1}. ${line}`), "");
  const near = neighbours(page, 3);
  if (near.length) lines.push(`${h} Related`, "", ...near.map((other) => `- [${other.h1}](${abs(`${problemPath(other)}.md`)})`), "");
  return absLinks(lines.join("\n"));
}

function header(title: string, route: string, tagline: string) {
  return [`# ${title}`, "", `> Markdown version of ${abs(route)} for agents and LLMs.`, `> ${tagline}`, ""].join("\n");
}

/** /how/<niche>/<slug>.md */
export function renderProblemMarkdown(page: ProblemPage): string {
  return `${header(page.h1, problemPath(page), page.description)}\n${problemBody(page).trimEnd()}\n\nGet Stella: ${abs("/download")}. ${PRICE_LINE}\n`;
}

const listLine = (page: ProblemPage) => `- [${page.h1}](${abs(`${problemPath(page)}.md`)}): ${page.description}`;

/** /how/<niche>.md */
export function renderNicheMarkdown(slug: string): string {
  const niche = getNiche(slug)!;
  const groups = nicheSections(niche)
    .map((group) => `${group.title ? `## ${group.title}\n\n` : ""}${group.pages.map(listLine).join("\n")}`)
    .join("\n\n");
  return `${header(niche.title, nichePath(niche), niche.description)}\n${niche.intro}\n\n${groups}\n`;
}

/** /how.md */
export function renderHowIndexMarkdown(): string {
  const parts = [
    header(
      "How-to guides",
      HOW_INDEX_PATH,
      "Specific problems answered properly, and Stella (stella.sh) doing them on your computer.",
    ),
  ];
  for (const niche of publishedNiches()) {
    parts.push(`## ${niche.name}`, "", ...nichePages(niche.slug).map(listLine), "");
  }
  return `${parts.join("\n").trimEnd()}\n`;
}

/** Lines for llms.txt: one section per niche. */
export function howLlmsSections(): string[] {
  const lines: string[] = [];
  for (const niche of publishedNiches()) {
    lines.push("", `## How-to: ${niche.name}`, ...nichePages(niche.slug).map(listLine));
  }
  return lines;
}

/** Every problem page in full, for llms-full.txt. */
export function howLlmsFull(): string[] {
  const parts = ["# How-to guides", ""];
  for (const niche of publishedNiches()) {
    for (const page of nichePages(niche.slug)) {
      parts.push(`## ${page.h1}`, "", `Source: ${abs(problemPath(page))}`, "", problemBody(page, 3), "");
    }
  }
  return parts;
}
