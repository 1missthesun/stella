export type Platform = "windows" | "mac" | "linux";

export type Faq = { q: string; a: string };

export type DemoText = {
  ack: string;
  task: string;
  rows: string[];
  reply: string;
  files?: string[];
};

export type ProblemPage = {
  slug: string;
  niche: string;
  searchPhrases: string[];
  title: string;
  description: string;
  h1: string;
  short: string;
  lede: string;
  answer: string;
  gets: string[];
  prompt: string;
  demo: DemoText;
  byHand?: string[];
  costNote?: string;
  platforms: Platform[];
  faq: Faq[];
  related: string[];
  lastChecked: string;
  draft?: boolean;
};

export type Niche = {
  slug: string;
  name: string;
  h1: string;
  title: string;
  description: string;
  intro: string;
  sections?: { title: string; slugs: string[] }[];
  recommended?: "claude" | "gemini" | "chatgpt";
  needsTopModel?: boolean;
  /** Body line of the hero PlanCallout on this hub and its guides. */
  planBody?: string;
};
