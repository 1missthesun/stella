"use client";

import { useRef, useState } from "react";
import { useTimeline } from "@/components/landing/motion";
import a from "./app-window.module.css";

type Phase = "safe" | "checking" | "needs" | "press" | "fixed";

type Scenario = {
  title: string;
  why: string;
  action: string;
  done: string;
};

/** Two real kinds of fix, alternating: one done in the app, one handed to the right page. */
const SCENARIOS: Scenario[] = [
  {
    title: "A bad extension is in Chrome",
    why: "“PDF Wizard” was named in today’s security news for stealing passwords.",
    action: "Remove it",
    done: "PDF Wizard removed from Chrome",
  },
  {
    title: "Your Canva password leaked",
    why: "Canva had a data breach and your email was in it. Change the password there.",
    action: "Change password",
    done: "Canva password page opened",
  },
];

const HANDLED = [
  "Chrome updated to 142",
  "3 new downloads checked",
  "Fake PayPal email moved to spam",
  "No sign of you in today’s 14 security stories",
];

const CYCLE = 14;

function phaseAt(local: number): Phase {
  if (local < 2.6) return "safe";
  if (local < 3.7) return "checking";
  if (local < 6.9) return "needs";
  if (local < 7.35) return "press";
  return "fixed";
}

/** The Stella Security window, living through one check: safe, one thing, fixed, safe. */
export function AppWindow({ className }: { className?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const [state, setState] = useState<{ cycle: number; phase: Phase }>({ cycle: 0, phase: "safe" });

  useTimeline(
    ref,
    (seconds) => {
      const cycle = Math.floor(seconds / CYCLE);
      const phase = phaseAt(seconds - cycle * CYCLE);
      setState((prev) => (prev.cycle === cycle && prev.phase === phase ? prev : { cycle, phase }));
    },
    { reducedAt: 5, threshold: 0.45 },
  );

  const { cycle, phase } = state;
  const scenario = SCENARIOS[cycle % SCENARIOS.length];
  const needs = phase === "needs" || phase === "press";
  const fixed = phase === "fixed";
  const heading = needs ? "1 thing needs you" : "You’re safe.";
  const checked = phase === "checking" ? "Checking now…" : fixed ? "Checked just now" : "Checked 12 minutes ago";

  return (
    <div ref={ref} className={[a.window, className].filter(Boolean).join(" ")} aria-hidden="true">
      <div className={a.bar}>
        <i />
        <i />
        <i />
        <span>Stella Security</span>
      </div>
      {/* Each loop starts from a fresh window, faded in, never rewound. */}
      <div key={cycle} className={a.body}>
        <div className={a.head}>
          <h3 key={heading} className={a.heading}>
            {heading}
          </h3>
          <p key={checked} className={a.checked}>
            <span className={a.dot} />
            {checked}
          </p>
        </div>

        <div className={a.item} data-open={needs ? "1" : "0"}>
          <div className={a.itemIn}>
            <p className={a.itemTitle}>{scenario.title}</p>
            <p className={a.itemWhy}>{scenario.why}</p>
            <span className={a.primary} data-pressed={phase === "press" ? "1" : "0"}>
              {scenario.action}
            </span>
            <span className={a.quiet}>Not now</span>
          </div>
        </div>

        <p className={a.label}>Handled</p>
        <ul className={a.list}>
          <li className={a.new} data-open={fixed ? "1" : "0"}>
            <div>
              <span>{scenario.done}</span>
              <time>Now</time>
            </div>
          </li>
          {HANDLED.map((row, i) => (
            <li key={row}>
              <div>
                <span>{row}</span>
                <time>{["11:20", "9:41", "8:15", "7:00"][i]}</time>
              </div>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
