/**
 * Problem pages: one page per specific problem someone searches for
 * ("install Sodium and Iris on Minecraft 1.21"), answered properly: a direct
 * answer, the chat with Stella that does it, the message to copy. Served at
 * /how/<niche>/<slug>. Written with shortGuide() (short.ts).
 *
 * Text fields accept the same light markup as the /ai pages: `code` spans and
 * [label](href) links. Keep them plain and specific.
 */

export type Platform = "windows" | "mac" | "linux";

export type Faq = { q: string; a: string };

/** A guide's exchange after the prompt, as data: what Stella says, does and answers. */
export type DemoText = {
  /** Stella's first reply, one short sentence. */
  ack: string;
  /** The task's name in Stella's list, e.g. "Sorting your downloads". */
  task: string;
  /** Two to four things it's seen doing, a few words each. */
  rows: string[];
  /** The final reply. May use **bold** and "- " bullets. */
  reply: string;
  /** Files it hands over, by name. */
  files?: string[];
};

export type ProblemPage = {
  /** URL segment, lowercase-hyphenated, matching the search phrase. */
  slug: string;
  /** Niche slug; the page lives at /how/<niche>/<slug>. */
  niche: string;
  /** What people type into Google, most common first. The first one drives the title. */
  searchPhrases: string[];
  /** <title> (without " | Stella"), ≤ 65 characters. */
  title: string;
  /** Meta description, 110–170 characters, says the answer. */
  description: string;
  /** The problem in the searcher's own words. */
  h1: string;
  /** Short label for breadcrumbs, related links and the hub list. */
  short: string;
  /** One line under the H1: the outcome in plain words, no product name (≤90 characters). */
  lede: string;
  /** One or two sentences that answer it. */
  answer: string;
  /** What you get or can ask for. */
  gets: string[];
  /** What you type to Stella: the first message of the demo and the one to copy. */
  prompt: string;
  /** The rest of the exchange the page plays (see lib/demo.ts). */
  demo: DemoText;
  /** Up to five short lines, folded at the bottom: how to do it without Stella. */
  byHand?: string[];
  /**
   * Replaces the shared "Is Stella free for this?" answer when part of the job
   * needs a paid Stella plan (e.g. Stella's own transcription or media models).
   */
  costNote?: string;
  /** Where Stella can do this. */
  platforms: Platform[];
  faq: Faq[];
  /** Slugs of neighbouring pages ("<niche>/<slug>"), shown as related problems. */
  related: string[];
  /** ISO date the facts were last checked. */
  lastChecked: string;
  /** Kept out of routes, sitemap and llms.txt; never fails the gate. */
  draft?: boolean;
};

export type Niche = {
  slug: string;
  /** Hub title, e.g. "Minecraft mods". */
  name: string;
  /** Hub H1. */
  h1: string;
  /** Meta title for the hub. */
  title: string;
  description: string;
  /** One or two sentences opening the hub. */
  intro: string;
  /**
   * Optional headed groups for a large hub, in display order. Each lists page
   * slugs in this niche; published pages not listed land in a final "More" group.
   */
  sections?: { title: string; slugs: string[] }[];
  /** The plan we'd pick for this topic, marked in the quiet model line under the hero. */
  recommended?: "claude" | "gemini" | "chatgpt";
};
