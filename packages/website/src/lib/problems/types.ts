/**
 * Problem pages: one page per specific problem someone searches for
 * ("install Sodium and Iris on Minecraft 1.21"), answered properly: a direct
 * answer, Stella doing it on a real computer, the prompt to paste, the manual
 * way, and where Stella stops. Served at /how/<niche>/<slug>.
 *
 * Text fields accept the same light markup as the /ai pages: `code` spans and
 * [label](href) links. Keep them plain and specific.
 */

export type Platform = "windows" | "mac" | "linux";

export type Source = { label: string; href: string };

/** One step of a how-to. `body` may hold `code` and [links](https://…). */
export type Step = { title: string; body: string };

export type Faq = { q: string; a: string };

/** A moment in a proof recording, for the transcript and the seekable step list. */
export type ProofMoment = {
  /** Seconds into the recording. */
  at: number;
  text: string;
};

export type ProofShot = {
  src: string;
  alt: string;
  width: number;
  height: number;
  caption?: string;
};

type ProofBase = {
  /** ISO date the run was recorded, e.g. "2026-11-10". */
  recordedOn: string;
  /** The computer it ran on, as a reader would say it: "Windows 11", "macOS 15", "Linux (Omarchy)". */
  platform: string;
  /** The engine and model that did the work, e.g. "ChatGPT plan (GPT-5.5)". */
  model: string;
  /** What the run produced, in one sentence: the evidence it worked. */
  result: string;
  /** Anything a careful reader should know about the run (sped up, trimmed, a retry). */
  note?: string;
};

/** A real screen recording of Stella doing the task. */
export type VideoProof = ProofBase & {
  kind: "video";
  video: {
    /** H.264 MP4, ~720p, a few MB. Absolute URL (R2) or a /public path. */
    src: string;
    poster: string;
    width: number;
    height: number;
    /** Length of the file as played, in seconds. */
    duration: number;
    /**
     * WebVTT captions. Leave out to use the ones built from `moments`, served at
     * /how/<niche>/<slug>/captions.vtt.
     */
    captions?: string;
    /** How much the recording is sped up, if at all (shown to the reader). */
    speed?: number;
    /** How long the run really took, in seconds, when sped up. */
    realDuration?: number;
  };
  /** Timestamped transcript of the run. Also rendered as text for search and screen readers. */
  moments: ProofMoment[];
  shots?: ProofShot[];
};

/** Real screenshots from a proof run, in order. */
export type ShotsProof = ProofBase & {
  kind: "shots";
  shots: ProofShot[];
};

export type Proof = VideoProof | ShotsProof;

/**
 * A page published before its proof run exists. Must say so on the page,
 * and only a few of these are allowed at a time (see the quality gate).
 */
export type StepsOnly = { kind: "steps-only"; reason: string };

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
  /** Two or three sentences that answer it, including the do-it-yourself route. */
  answer: string;
  /** What Stella does on this problem, in order, in plain words. */
  stellaSteps: string[];
  /** The exact prompt to paste into Stella. */
  prompt: string;
  proof: Proof | StepsOnly;
  /** The honest manual way, complete enough to follow without Stella. */
  manualSteps: Step[];
  /** Heading over the manual steps; defaults to "Do it yourself". */
  manualTitle?: string;
  /** What Stella won't or can't do here. */
  limits: string[];
  /** Where Stella can do this. Linux-only gaps belong in `limits` too. */
  platforms: Platform[];
  faq: Faq[];
  /** Slugs of neighbouring pages ("<niche>/<slug>"), shown as related problems. */
  related: string[];
  /** ISO date the manual steps and facts were last checked. */
  lastChecked: string;
  sources: Source[];
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
};
