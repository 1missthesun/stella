"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { useTimeline } from "./motion";
import { StellaCharacter } from "./stella-character";
import { ThemeGradient, windowThemeStyle, type WindowThemeKey } from "./window-theme";
import d from "./devices-act.module.css";

const THEME: WindowThemeKey = { id: "default", dark: true };

const CUES = {
  m1: 0.5,
  type: 1.2,
  m2: 1.9,
  hand: 3.1,
  wake: 3.6,
  m3: 4.6,
  m4: 5.4,
  dive: 6.2,
  fly: 6.55,
  land: 7.3,
  work: 8.25,
  r1: 8.8,
  r2: 9.35,
  r3: 9.9,
  m5: 10.6,
  reset: 13.2,
} as const;

const LOOP = 13.9;
const REDUCED_AT = 12;

const STEPS = [
  { at: 0, label: "Start on your laptop." },
  { at: CUES.hand, label: "Pick up on your phone." },
  { at: CUES.dive, label: "Stella goes to your other computer." },
];

type Layout = "wide" | "narrow";

const SIZE: Record<Layout, { w: number; h: number }> = {
  wide: { w: 1200, h: 600 },
  narrow: { w: 400, h: 690 },
};

const PATHS: Record<Layout, { hand: string; fly: string }> = {
  wide: {
    hand: "M300 214 C 380 70, 540 110, 600 290",
    fly: "M537 220 C 600 0, 830 -40, 935 152",
  },
  narrow: {
    hand: "M100 105 C 70 230, 150 260, 200 330",
    fly: "M131 291 C 120 170, 250 40, 303 86",
  },
};

function Bubble({ me, cue, children }: { me?: boolean; cue: string; children: ReactNode }) {
  return (
    <p className={me ? d.me : d.her} data-cue={cue}>
      {children}
    </p>
  );
}

function Lights() {
  return (
    <span className={d.lights}>
      <i />
      <i />
      <i />
    </span>
  );
}

export function DevicesAct() {
  const sectionRef = useRef<HTMLElement>(null);
  const viewRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const stepRefs = useRef<(HTMLLIElement | null)[]>([]);
  const [layout, setLayout] = useState<Layout>("wide");

  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    const measure = () => {
      const r = view.getBoundingClientRect();
      const next: Layout = r.width < 720 ? "narrow" : "wide";
      setLayout(next);
      const { w, h } = SIZE[next];
      view.style.setProperty("--fit", String(Math.min(r.width / w, r.height / h)));
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(view);
    return () => ro.disconnect();
  }, []);

  useTimeline(
    sectionRef,
    (seconds) => {
      const stage = stageRef.current;
      if (!stage) return;
      const t = seconds % LOOP;
      for (const [name, at] of Object.entries(CUES)) {
        const on = t >= at ? "1" : "0";
        if (stage.dataset[name] !== on) stage.dataset[name] = on;
      }
      let active = 0;
      STEPS.forEach((s, i) => {
        if (t >= s.at) active = i;
      });
      stepRefs.current.forEach((el, i) => {
        if (!el) return;
        const on = i === active && t < CUES.reset ? "1" : "0";
        if (el.dataset.on !== on) el.dataset.on = on;
      });
    },
    { reducedAt: REDUCED_AT, threshold: 0.3 },
  );

  const paths = PATHS[layout];

  return (
    <section ref={sectionRef} className={d.act} data-tone="dark" data-bg="#060609" aria-labelledby="devices-title">
      <div className={d.head}>
        <h2 id="devices-title" className={d.title}>
          Ask here. <span>Done there.</span>
        </h2>
        <ol className={d.steps}>
          {STEPS.map((s, i) => (
            <li
              key={s.label}
              ref={(el) => {
                stepRefs.current[i] = el;
              }}
              data-on={i === 0 ? "1" : "0"}
            >
              {s.label}
            </li>
          ))}
        </ol>
      </div>

      <div ref={viewRef} className={d.view} aria-hidden="true">
        <div
          ref={stageRef}
          className={d.stage}
          data-layout={layout}
          style={{ ...windowThemeStyle(THEME), width: SIZE[layout].w, height: SIZE[layout].h }}
        >
          <div className={d.laptop}>
            <div className={d.lid}>
              <div className={d.screen}>
                <div className={d.backdrop}>
                  <ThemeGradient theme={THEME} width={200} height={130} />
                </div>
                <div className={d.app}>
                  <div className={d.appBar}>
                    <Lights />
                    <StellaCharacter size={18} eyeColor="var(--w-bg)" className={d.appMark} />
                  </div>
                  <div className={d.thread}>
                    <Bubble me cue="m1">
                      Plan our Lisbon trip in May
                    </Bubble>
                    <p className={d.typing} data-cue="type">
                      <i />
                      <i />
                      <i />
                    </p>
                    <Bubble cue="m2">Flights and two hotels are in Trip.doc. Hold the 9th?</Bubble>
                  </div>
                  <div className={d.compose}>
                    <span>Do anything</span>
                    <i />
                  </div>
                </div>
                <div className={d.away}>
                  <span className={d.toast}>
                    <svg viewBox="0 0 24 24">
                      <rect x="7" y="2.5" width="10" height="19" rx="2.5" />
                      <path d="M11 18.5h2" />
                    </svg>
                    Continued on iPhone
                  </span>
                </div>
              </div>
            </div>
            <div className={d.base} />
            <p className={d.label}>MacBook</p>
          </div>

          <div className={d.pc}>
            <div className={d.monitor}>
              <div className={d.screen}>
                <div className={d.backdrop}>
                  <ThemeGradient theme={THEME} width={200} height={120} />
                </div>
                <div className={d.sleep}>
                  <b>Home PC</b>
                  <span>Asleep</span>
                </div>
                <div className={d.work}>
                  <div className={d.appBar}>
                    <Lights />
                    <span className={d.workTitle}>
                      <StellaCharacter size={16} eyeColor="var(--w-bg)" state="working" />
                      Freeing up space
                    </span>
                  </div>
                  <div className={d.disk}>
                    <div className={d.diskHead}>
                      <span>Storage</span>
                      <b>
                        <span className={d.freedOld}>476 GB · 97% full</span>
                        <span className={d.freedNew}>38.2 GB freed</span>
                      </b>
                    </div>
                    <div className={d.meter}>
                      <i />
                    </div>
                  </div>
                  <ul className={d.rows}>
                    <li data-cue="r1">
                      <em />
                      <span>Old installers</span>
                      <b>18.2 GB</b>
                    </li>
                    <li data-cue="r2">
                      <em />
                      <span>Duplicate photos</span>
                      <b>9.6 GB</b>
                    </li>
                    <li data-cue="r3">
                      <em />
                      <span>Downloads from 2023</span>
                      <b>10.4 GB</b>
                    </li>
                  </ul>
                </div>
                <div className={d.portal} data-at="pc">
                  <i />
                </div>
                <div className={d.arrive}>
                  <StellaCharacter size={null} eyeColor="#0b0b10" glow className={d.arriveMark} />
                </div>
              </div>
            </div>
            <div className={d.neck} />
            <div className={d.foot} />
            <p className={d.label}>Home PC</p>
          </div>

          <div className={d.phone}>
            <div className={d.handset}>
              <div className={d.phoneScreen}>
                <div className={d.backdrop}>
                  <ThemeGradient theme={THEME} width={120} height={240} />
                </div>
                <div className={d.status}>
                  <b>9:41</b>
                  <span className={d.island} />
                  <i />
                </div>
                <div className={d.lock}>
                  <b>9:41</b>
                  <span>Tuesday, May 2</span>
                </div>
                <div className={d.phoneApp}>
                  <div className={d.phoneHead}>
                    <span className={d.headMark}>
                      <StellaCharacter size={26} eyeColor="var(--w-bg)" />
                      <span className={d.portal} data-at="phone">
                        <i />
                      </span>
                    </span>
                    <span className={d.headText}>
                      <b>Stella</b>
                      <small>
                        <span className={d.here}>Here with you</span>
                        <span className={d.there}>
                          <i />
                          Working on Home PC
                        </span>
                      </small>
                    </span>
                  </div>
                  <div className={d.phoneThread}>
                    <span className={d.pill}>Continued from MacBook</span>
                    <p className={d.me}>Plan our Lisbon trip in May</p>
                    <p className={d.her}>Flights and two hotels are in Trip.doc. Hold the 9th?</p>
                    <Bubble me cue="m3">
                      Yes. And clear some space on my home PC
                    </Bubble>
                    <Bubble cue="m4">Heading there now.</Bubble>
                    <Bubble cue="m5">Done. 38 GB free on your Home PC.</Bubble>
                  </div>
                  <div className={d.phoneCompose}>
                    <span>Do anything</span>
                    <i />
                  </div>
                </div>
                <span className={d.homebar} />
              </div>
            </div>
            <p className={d.label}>iPhone</p>
          </div>

          <svg className={d.trails} viewBox={`0 0 ${SIZE[layout].w} ${SIZE[layout].h}`} aria-hidden="true">
            <defs>
              <linearGradient id="hop-trail" x1="0" y1="1" x2="1" y2="0">
                <stop offset="0" stopColor="#00eeff" />
                <stop offset="0.45" stopColor="#8b6cff" />
                <stop offset="1" stopColor="#ff4ac0" />
              </linearGradient>
            </defs>
            <path className={d.trailHand} d={paths.hand} pathLength={1} />
            <path className={d.trailFly} d={paths.fly} pathLength={1} />
          </svg>
          <span className={d.orbHand} style={{ offsetPath: `path("${paths.hand}")` }} />
          <span className={d.orbFly} style={{ offsetPath: `path("${paths.fly}")` }}>
            <StellaCharacter size={30} eyeColor="#0b0b10" glow />
          </span>
        </div>
      </div>
    </section>
  );
}
