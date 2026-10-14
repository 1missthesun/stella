"use client";

import { useRef, type ReactNode } from "react";
import { prefersReducedMotion, useLayerLive } from "./motion";
import { StellaCharacter } from "./stella-character";
import v from "./skin-dev.module.css";

type Tok = [string, string?];
type Line = { kind: " " | "+" | "-"; n: number; code: Tok[] };

const DIFF: Line[] = [
  { kind: " ", n: 12, code: [["import", "k"], [" { useTheme } "], ["from", "k"], [' "@/theme"', "s"], [";"]] },
  { kind: "+", n: 13, code: [["import", "k"], [" { ThemeToggle } "], ["from", "k"], [' "./ThemeToggle"', "s"], [";"]] },
  { kind: " ", n: 14, code: [[""]] },
  { kind: " ", n: 15, code: [["export function", "k"], [" "], ["SettingsPage", "f"], ["() {"]] },
  { kind: "-", n: 16, code: [["  const", "k"], [" bg = "], ['"#ffffff"', "s"], [";"]] },
  { kind: "-", n: 17, code: [["  const", "k"], [" fg = "], ['"#111111"', "s"], [";"]] },
  { kind: "+", n: 16, code: [["  const", "k"], [" { tokens, mode, setMode } = "], ["useTheme", "f"], ["();"]] },
  { kind: " ", n: 18, code: [["  return", "k"], [" ("]] },
  { kind: "-", n: 19, code: [["    <", "p"], ["Page", "t"], [" style", "a"], ["={{ background: bg }}>"]] },
  { kind: "+", n: 19, code: [["    <", "p"], ["Page", "t"], [" tokens", "a"], ["={tokens}>"]] },
  { kind: " ", n: 20, code: [["      <", "p"], ["Section", "t"], [" title", "a"], ["="], ['"Appearance"', "s"], [">"]] },
  { kind: "+", n: 21, code: [["        <", "p"], ["ThemeToggle", "t"], [" mode", "a"], ["={mode} "], ["set", "a"], ["={setMode} />"]] },
  { kind: " ", n: 22, code: [["      </", "p"], ["Section", "t"], [">"]] },
  { kind: "+", n: 23, code: [["      <", "p"], ["Section", "t"], [" title", "a"], ["="], ['"Contrast"', "s"], [">"]] },
  { kind: "+", n: 24, code: [["        <", "p"], ["ContrastPreview", "t"], [" tokens", "a"], ["={tokens} />"]] },
  { kind: "+", n: 25, code: [["      </", "p"], ["Section", "t"], [">"]] },
  { kind: " ", n: 26, code: [["    </", "p"], ["Page", "t"], [">"]] },
];

const FILES = [
  { name: "SettingsPage.tsx", add: 38, del: 12, on: true },
  { name: "ThemeToggle.tsx", add: 96, del: 0 },
  { name: "theme.ts", add: 51, del: 25 },
  { name: "settings.test.ts", add: 29, del: 0 },
];

const AGENTS = [
  { title: "Dark mode for settings", meta: "Ready for review", state: "review", on: true },
  { title: "Fix flaky checkout test", meta: "Running", state: "run" },
  { title: "Debounce search input", meta: "Queued", state: "wait" },
  { title: "Bump Next to 16.2", meta: "Merged #481", state: "merged" },
];

const STEPS: { icon: string; body: ReactNode }[] = [
  { icon: "read", body: <>Read <code>theme.ts</code> and 5 more</> },
  { icon: "edit", body: <>Edited 4 files <em data-c="add">+214</em> <em data-c="del">−37</em></> },
  { icon: "run", body: <>Ran <code>bun test settings</code>, 24 passed</> },
  { icon: "eye", body: <>Checked light and dark in the preview</> },
];

const CHECKS = [
  { name: "typecheck", time: "18s" },
  { name: "build", time: "1m 02s" },
  { name: "e2e", time: "2m 10s" },
];

function Icon({ name }: { name: string }) {
  switch (name) {
    case "read":
      return (
        <svg viewBox="0 0 16 16" aria-hidden="true">
          <path d="M3 2.5h6.5L13 6v7.5H3z" />
          <path d="M9.5 2.5V6H13" />
        </svg>
      );
    case "edit":
      return (
        <svg viewBox="0 0 16 16" aria-hidden="true">
          <path d="M10.5 2.5l3 3L6 13H3v-3z" />
        </svg>
      );
    case "run":
      return (
        <svg viewBox="0 0 16 16" aria-hidden="true">
          <path d="M2.5 3.5h11v9h-11z" />
          <path d="M5 7l2 1.5L5 10M8.5 10.5H11" />
        </svg>
      );
    case "eye":
      return (
        <svg viewBox="0 0 16 16" aria-hidden="true">
          <path d="M1.5 8S4 3.5 8 3.5 14.5 8 14.5 8 12 12.5 8 12.5 1.5 8 1.5 8z" />
          <circle cx="8" cy="8" r="2" />
        </svg>
      );
    case "branch":
      return (
        <svg viewBox="0 0 16 16" aria-hidden="true">
          <circle cx="4.5" cy="3.5" r="1.5" />
          <circle cx="4.5" cy="12.5" r="1.5" />
          <circle cx="11.5" cy="5" r="1.5" />
          <path d="M4.5 5v6M11.5 6.5c0 3-7 2-7 4.5" />
        </svg>
      );
    case "pr":
      return (
        <svg viewBox="0 0 16 16" aria-hidden="true">
          <circle cx="4" cy="3.5" r="1.5" />
          <circle cx="4" cy="12.5" r="1.5" />
          <circle cx="12" cy="12.5" r="1.5" />
          <path d="M4 5v6M12 11V6.5a2 2 0 0 0-2-2H7.5M9 3l-1.5 1.5L9 6" />
        </svg>
      );
    case "merged":
      return (
        <svg viewBox="0 0 16 16" aria-hidden="true">
          <circle cx="4" cy="3.5" r="1.5" />
          <circle cx="4" cy="12.5" r="1.5" />
          <circle cx="12" cy="8" r="1.5" />
          <path d="M4 5v6M4 5c0 2.5 2.5 3 6.5 3" />
        </svg>
      );
    default:
      return null;
  }
}

function Status({ state }: { state: string }) {
  if (state === "run") return <i className={v.spin} />;
  if (state === "merged")
    return (
      <span className={v.merged}>
        <Icon name="merged" />
      </span>
    );
  if (state === "wait") return <i className={v.dotWait} />;
  return <i className={v.dotReview} />;
}

export function DevSkin() {
  const rootRef = useRef<HTMLDivElement>(null);
  const clockRef = useRef<HTMLElement>(null);

  useLayerLive(rootRef, (live) => {
    const root = rootRef.current;
    if (!root) return;
    root.dataset.play = live ? "1" : "0";
    if (!live || prefersReducedMotion()) return;
    const start = performance.now();
    const tick = (now: number) => {
      if (root.dataset.play !== "1") return;
      const s = 128 + Math.floor((now - start) / 1000);
      if (clockRef.current) clockRef.current.textContent = `${Math.floor(s / 60)}m ${String(s % 60).padStart(2, "0")}s`;
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });

  return (
    <div ref={rootRef} className={v.dev} data-play="0">
      <header className={v.bar}>
        <span className={v.lights}>
          <i />
          <i />
          <i />
        </span>
        <span className={v.repo}>
          <b>atlas-web</b>
          <span className={v.branch}>
            <Icon name="branch" />
            main
          </span>
        </span>
        <span className={v.activity}>
          <StellaCharacter size={18} eyeColor="#0c0c0e" state="working" />
          <span>2 agents running</span>
        </span>
        <span className={v.account}>
          Account <small>Pro</small>
        </span>
      </header>

      <div className={v.body}>
        <aside className={v.side}>
          <div className={v.sideItem} data-on="1">
            <StellaCharacter size={16} eyeColor="#16161a" />
            <span>Stella</span>
          </div>
          <div className={v.sideItem}>
            <svg viewBox="0 0 16 16" aria-hidden="true">
              <path d="M8 3v10M3 8h10" />
            </svg>
            <span>New agent</span>
            <kbd>⌘N</kbd>
          </div>
          <p className={v.sideHead}>Agents</p>
          {AGENTS.map((a) => (
            <div key={a.title} className={v.agent} data-state={a.state} data-on={a.on ? "1" : "0"}>
              <Status state={a.state} />
              <span className={v.agentText}>
                <span className={v.agentTitle}>{a.title}</span>
                <span className={v.agentMeta}>
                  {a.meta}
                  {a.state === "run" ? (
                    <>
                      {" · "}
                      <b ref={clockRef}>2m 08s</b>
                    </>
                  ) : null}
                </span>
              </span>
            </div>
          ))}
          <p className={v.sideHead}>Today</p>
          <div className={v.sideNote}>
            <span>Dentist</span>
            <b>4:30</b>
          </div>
          <div className={v.sideNote}>
            <span>Gym with Theo</span>
            <b>7:00</b>
          </div>
        </aside>

        <main className={v.chat}>
          <div className={v.thread}>
            <p className={v.stamp}>Today 10:14 AM</p>
            <p className={v.me}>Push my 3pm with Dana to tomorrow</p>
            <p className={v.her}>Moved to 3pm tomorrow. Dana accepted.</p>
            <p className={v.me}>Add dark mode to the settings page in atlas</p>
            <div className={v.herBlock}>
              <p className={v.her}>On it, in its own worktree.</p>
              <div className={v.run}>
                <div className={v.runHead}>
                  <span className={v.runState}>
                    <i className={v.spin} />
                    <svg className={v.check} viewBox="0 0 16 16" aria-hidden="true">
                      <path d="M3.5 8.5l3 3 6-7" />
                    </svg>
                  </span>
                  <b>Dark mode for settings</b>
                  <span className={v.chip}>
                    <Icon name="branch" />
                    stella/dark-settings
                  </span>
                  <span className={v.runTime}>3m 41s</span>
                </div>
                <ol className={v.steps}>
                  {STEPS.map((s, i) => (
                    <li key={s.icon} style={{ ["--i" as string]: i }}>
                      <span className={v.stepIcon}>
                        <Icon name={s.icon} />
                      </span>
                      <span>{s.body}</span>
                    </li>
                  ))}
                </ol>
              </div>
            </div>
            <p className={v.her} data-late="1">
              Done. <b className={v.prLink}>PR #482</b> is up and every check is green.
            </p>
          </div>
          <div className={v.composer}>
            <span className={v.composerText}>Ask Stella, or @ an agent</span>
            <span className={v.model}>Claude Opus · high</span>
            <span className={v.send}>
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <path d="M12 19V5M6 11l6-6 6 6" />
              </svg>
            </span>
          </div>
        </main>

        <section className={v.review}>
          <div className={v.tabs}>
            <span data-on="1">Changes</span>
            <span>Preview</span>
            <span>Terminal</span>
            <span className={v.prButton}>
              <span className={v.prCreate}>Create PR</span>
              <span className={v.prOpen}>
                <Icon name="pr" />
                #482
              </span>
            </span>
          </div>
          <div className={v.files}>
            {FILES.map((f) => (
              <span key={f.name} data-on={f.on ? "1" : "0"}>
                {f.name}
                <em data-c="add">+{f.add}</em>
                {f.del ? <em data-c="del">−{f.del}</em> : null}
              </span>
            ))}
          </div>
          <div className={v.diff}>
            <p className={v.hunk}>@@ -12,11 +12,15 @@ SettingsPage</p>
            {DIFF.map((line, i) => (
              <p key={i} className={v.line} data-k={line.kind} style={{ ["--i" as string]: i }}>
                <span className={v.ln}>{line.kind === "+" ? "" : line.n}</span>
                <span className={v.ln}>{line.kind === "-" ? "" : line.n}</span>
                <span className={v.sign}>{line.kind === " " ? "" : line.kind}</span>
                <code>
                  {line.code.map(([text, c], j) => (
                    <span key={j} data-c={c}>
                      {text}
                    </span>
                  ))}
                </code>
              </p>
            ))}
          </div>
          <div className={v.pr}>
            <div className={v.prHead}>
              <Icon name="pr" />
              <b>Dark mode for settings</b>
              <span>#482</span>
            </div>
            <p className={v.prSub}>stella/dark-settings → main</p>
            {CHECKS.map((c, i) => (
              <div key={c.name} className={v.checkRow} style={{ ["--i" as string]: i }}>
                <span className={v.checkState}>
                  <i className={v.spin} />
                  <svg viewBox="0 0 16 16" aria-hidden="true">
                    <path d="M3.5 8.5l3 3 6-7" />
                  </svg>
                </span>
                <span>{c.name}</span>
                <em>{c.time}</em>
              </div>
            ))}
            <div className={v.merge}>
              <span>Ready to merge</span>
              <b>Merge</b>
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}
