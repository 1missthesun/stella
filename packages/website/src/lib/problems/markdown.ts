import { PRICE_LINE } from "@/lib/answers";
import { getSiteUrl } from "@/lib/site-url";
import {
  HOW_INDEX_PATH,
  PLATFORM_NAMES,
  formatDate,
  formatDuration,
  getNiche,
  neighbours,
  nichePages,
  nichePath,
  problemPath,
  publishedNiches,
  sharedFaq,
  type ProblemPage,
} from ".";

const abs = (path: string) => new URL(path, getSiteUrl()).href;
const absLinks = (text: string) => text.replace(/\]\(\//g, `](${getSiteUrl().origin}/`);

const stamp = (seconds: number) => `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, "0")}`;

/** The body of a problem page, headings starting at `level`. */
export function problemBody(page: ProblemPage, level = 2): string {
  const h = "#".repeat(level);
  const lines: string[] = [page.answer, ""];
  lines.push(
    `- Checked: ${formatDate(page.lastChecked)}`,
    `- Stella does it on: ${page.platforms.map((p) => PLATFORM_NAMES[p]).join(", ")}`,
    "",
    `${h} Stella doing it`,
    "",
  );
  const proof = page.proof;
  if (proof.kind === "steps-only") {
    lines.push(`No recording yet. ${proof.reason}`, "");
  } else {
    lines.push(
      `Recorded ${formatDate(proof.recordedOn)} on ${proof.platform} with ${proof.model}.`,
      `Result: ${proof.result}${proof.note ? ` ${proof.note}` : ""}`,
      "",
    );
    if (proof.kind === "video") {
      const speed = proof.video.speed && proof.video.speed > 1 ? `, sped up ${proof.video.speed}×` : "";
      lines.push(`Video (${formatDuration(proof.video.duration)}${speed}): ${abs(proof.video.src)}`, "", "Transcript:", "");
      for (const moment of proof.moments) lines.push(`- ${stamp(moment.at)} ${moment.text}`);
      lines.push("");
    }
  }
  lines.push("What Stella does:", "");
  page.stellaSteps.forEach((step, i) => lines.push(`${i + 1}. ${step}`));
  lines.push(
    "",
    `${h} The prompt to paste`,
    "",
    "```text",
    page.prompt,
    "```",
    "",
    `${h} ${page.manualTitle ?? "Do it yourself"}`,
    "",
  );
  page.manualSteps.forEach((step, i) => lines.push(`${i + 1}. **${step.title}.** ${step.body}`));
  lines.push("", `${h} Where Stella stops`, "", ...page.limits.map((limit) => `- ${limit}`), "", `${h} Questions`, "");
  for (const item of [...page.faq, ...sharedFaq(page)]) lines.push(`**${item.q}**`, item.a, "");
  lines.push(`Sources: ${page.sources.map((s) => `[${s.label}](${s.href})`).join(", ")}.`, "");
  const near = neighbours(page);
  if (near.length) {
    lines.push(`${h} Related problems`, "");
    for (const other of near) lines.push(`- [${other.h1}](${abs(`${problemPath(other)}.md`)})`);
    lines.push("");
  }
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
  return `${header(niche.title, nichePath(niche), niche.description)}\n${niche.intro}\n\n${nichePages(slug).map(listLine).join("\n")}\n`;
}

/** /how.md */
export function renderHowIndexMarkdown(): string {
  const parts = [
    header(
      "How-to guides",
      HOW_INDEX_PATH,
      "Specific problems answered properly: the manual steps, and Stella (stella.sh) doing it on a real computer.",
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
