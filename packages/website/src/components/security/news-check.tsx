"use client";

import { useRef, useState } from "react";
import { useTimeline } from "@/components/landing/motion";
import n from "./news-check.module.css";

type Story = {
  source: string;
  headline: string;
  /** What the check found on this computer. */
  verdict: string;
  hit?: { detail: string };
};

const STORIES: Story[] = [
  {
    source: "Security news · 2h",
    headline: "Fake “QuickTab Saver” extension steals passwords",
    verdict: "Not in your browser",
  },
  {
    source: "Security news · 4h",
    headline: "Card-stealing code found on 178 big websites",
    verdict: "Affects you",
    hit: { detail: "Two of those sites are in your browser history this month." },
  },
  {
    source: "Security news · 6h",
    headline: "Travel site leaks 4 million email addresses",
    verdict: "Your email isn’t in it",
  },
  {
    source: "Security news · 9h",
    headline: "Popular game mod hijacked to spread malware",
    verdict: "Not on your computer",
  },
];

/** Seconds into the section at which each story gets its answer. */
const FIRST = 0.9;
const STEP = 0.85;

/** Today's stories, each answered against this computer: one of them touches you. */
export function NewsCheck() {
  const ref = useRef<HTMLDivElement>(null);
  const [answered, setAnswered] = useState(0);

  useTimeline(
    ref,
    (seconds) => {
      const next = Math.max(0, Math.min(STORIES.length, Math.floor((seconds - FIRST) / STEP) + 1));
      setAnswered((prev) => (prev === next ? prev : next));
    },
    { reducedAt: 60, threshold: 0.4 },
  );

  return (
    <div ref={ref} className={n.board}>
      <ol className={n.list}>
        {STORIES.map((story, i) => {
          const done = i < answered;
          return (
            <li key={story.headline} className={n.story} data-done={done ? "1" : "0"} data-hit={story.hit ? "1" : "0"}>
              <div className={n.row}>
                <div className={n.text}>
                  <span className={n.source}>{story.source}</span>
                  <span className={n.headline}>{story.headline}</span>
                </div>
                <span className={n.verdict}>
                  {story.hit ? <i className={n.dot} aria-hidden="true" /> : null}
                  {story.verdict}
                </span>
              </div>
              {story.hit ? (
                <div className={n.detail}>
                  <p>{story.hit.detail}</p>
                </div>
              ) : null}
            </li>
          );
        })}
      </ol>
    </div>
  );
}
