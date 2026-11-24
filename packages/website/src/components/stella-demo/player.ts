import type { RefObject } from "react";
import {
  ACTIVITY_INDICATOR_LABEL_IN_DELAY_MS,
  ACTIVITY_INDICATOR_LABEL_IN_MS,
  ACTIVITY_INDICATOR_LABEL_OUT_MS,
  ACTIVITY_INDICATOR_POP_RISE_MS,
  ACTIVITY_INDICATOR_POP_SCALE,
  ACTIVITY_INDICATOR_POP_SETTLE_SPRING,
  ACTIVITY_INDICATOR_SETTLE_SPRING,
  ACTIVITY_INDICATOR_SPAWN_BEAT_MS,
} from "@stella/contracts/activity-indicator";
import { WORKING_INDICATOR_THINKING_LABEL_MS, WORKING_INDICATOR_THINKING_TEXT } from "@stella/contracts/working-status";
import type { StellaMarkHandle } from "@/components/landing/stella-character";
import type { DemoStep } from "@/lib/demo";
import { APP_COMPOSER_PLACEHOLDER as PLACEHOLDER, APP_TIMING } from "./app-timing.generated";

export type DemoParts = {
  root: HTMLElement;
  caption: HTMLElement;
  trigger: HTMLElement;
  topMarkBox: HTMLElement;
  topLabel: HTMLElement;
  chatLayer: HTMLElement;
  scroller: HTMLElement;
  divider: HTMLElement;
  rows: Map<number, HTMLElement>;
  indicator: HTMLElement;
  indicatorBubble: HTMLElement;
  status: HTMLElement;
  dockField: HTMLElement;
  dockForm: HTMLElement;
  dockStop: HTMLElement;
  dockSubmit: HTMLElement;
  home: HTMLElement;
  greeting: HTMLElement;
  homeField: HTMLElement;
  homeForm: HTMLElement;
  homeSubmit: HTMLElement;
  menu?: HTMLElement;
  taskRow?: HTMLElement;
  taskLabel?: HTMLElement;
  progress?: HTMLElement;
  indicatorMark: RefObject<StellaMarkHandle | null>;
  topMark: RefObject<StellaMarkHandle | null>;
  replay?: () => void;
};

export type DemoPlayer = {
  pause(): void;
  resume(): void;
  setVisible(visible: boolean): void;
  destroy(): void;
};

type Status = "idle" | "playing" | "paused" | "done";

/** What the replica's still frame shows before it plays (also set by an inline script before hydration). */
export const greetingFor = (date: Date) => {
  const hour = date.getHours();
  if (hour < 5) return "Good night";
  if (hour < 12) return "Good morning";
  if (hour < 17) return "Good afternoon";
  if (hour < 21) return "Good evening";
  return "Good night";
};

const SWAP_MS = 240;
const SWAP_EASE = "cubic-bezier(0.22, 1, 0.36, 1)";
const POP_EASE = "cubic-bezier(0.33, 1, 0.68, 1)";
const WORK_STATUS = "Working on it";

/** Pacing of the replayed exchange: how long people take, not how long the app takes. */
const PACE = {
  lead: 700,
  typingTotalMs: 2300,
  typingMinCharMs: 14,
  typingMaxCharMs: 42,
  holdBeforeSend: 420,
  firstReplyAfterSend: 1900,
  ackAfterSend: 2900,
  taskBeforeAck: 650,
  menuAfterAck: 700,
  rowEvery: 1500,
  doneAfterLastRow: 1300,
  menuCloseAfterDone: 650,
  replyAfterDone: 1900,
  cardAfterReply: 700,
  readPerWord: 150,
  readMin: 1100,
  readMax: 3200,
  end: 400,
};

/** A spring as a CSS linear() easing: critically shaped by damping ratio over `duration`. */
function springEasing(dampingRatio: number, settleRadians = 7) {
  const points: string[] = [];
  const zeta = Math.min(dampingRatio, 0.999);
  const omega = settleRadians / zeta;
  const wd = omega * Math.sqrt(1 - zeta * zeta);
  for (let i = 0; i <= 40; i++) {
    const t = i / 40;
    const x = 1 - Math.exp(-zeta * omega * t) * (Math.cos(wd * t) + ((zeta * omega) / wd) * Math.sin(wd * t));
    points.push(x.toFixed(4));
  }
  return `linear(${points.join(", ")})`;
}

/** Keyframes of a mass-1 spring from `from` to `to` (motion's damping/stiffness spring). */
function springFrames(from: number, to: number, { damping, stiffness }: { damping: number; stiffness: number }) {
  const frames: number[] = [];
  let x = from;
  let v = 0;
  const dt = 1 / 120;
  for (let i = 0; i < 240; i++) {
    const a = -stiffness * (x - to) - damping * v;
    v += a * dt;
    x += v * dt;
    if (i % 2 === 0) frames.push(x);
    if (Math.abs(x - to) < 0.0005 && Math.abs(v) < 0.005) break;
  }
  frames.push(to);
  return { frames, durationMs: frames.length * 2 * (1000 / 120) };
}

const fmtTime = (date: Date) => `Today ${date.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}`;

export function playDemo(steps: DemoStep[], parts: DemoParts, onStatus: (status: Status) => void, startVisible: boolean): DemoPlayer {
  const p = parts;
  type Action = { at: number; run: () => void };
  const actions: Action[] = [];
  const animations = new Set<Animation>();
  const shimmers = new Map<HTMLElement, { priority: number; stop: () => void; start: () => void; running: boolean }>();
  let clock = 0;
  let last = 0;
  let raf = 0;
  let paused = false;
  let visible = startVisible;
  let destroyed = false;
  let following = true;

  const at = (time: number, run: () => void) => actions.push({ at: time, run });
  const track = (animation: Animation) => {
    animations.add(animation);
    if (paused || !visible) animation.pause();
    animation.finished.then(() => animations.delete(animation), () => animations.delete(animation));
    return animation;
  };
  const animate = (el: Element, frames: Keyframe[], options: KeyframeAnimationOptions) => track(el.animate(frames, options));
  const restart = (el: HTMLElement) => {
    el.style.animation = "none";
    void el.offsetWidth;
    el.style.animation = "";
  };

  /* Text shimmer, as TextShimmer: one sweep, a rest, again; one per exclusive group, highest priority wins. */
  const refreshShimmers = () => {
    let top: HTMLElement | null = null;
    for (const [el, s] of shimmers) if (!top || s.priority > shimmers.get(top)!.priority) top = el;
    for (const [el, s] of shimmers) {
      if (el === top && !s.running) s.start();
      if (el !== top && s.running) s.stop();
    }
  };
  const shimmer = (host: HTMLElement, text: string, priority: number, durationMs?: number) => {
    unshimmer(host);
    host.innerHTML = "";
    const root = document.createElement("span");
    root.className = "text-shimmer";
    const base = document.createElement("span");
    base.className = "text-shimmer__base";
    base.textContent = text;
    root.append(base);
    host.append(root);
    const duration = durationMs ?? Math.max(1400, Math.min(4000, text.length * 95));
    const sweepMs = Math.min(2200, Math.max(1400, duration * 0.85));
    const restMs = Math.max(3000, duration * 1.5);
    let timer = 0;
    let current: Animation[] = [];
    const state = {
      priority,
      running: false,
      start: () => {
        state.running = true;
        root.classList.add("text-shimmer--active");
        const sweep = document.createElement("span");
        sweep.className = "text-shimmer__sweep";
        sweep.setAttribute("aria-hidden", "true");
        const sweepText = document.createElement("span");
        sweepText.className = "text-shimmer__sweep-text";
        sweepText.textContent = text;
        sweep.append(sweepText);
        root.append(sweep);
        const run = () => {
          if (!state.running) return;
          current = [
            animate(sweep, [{ transform: "translate3d(-100%, 0, 0)" }, { transform: "translate3d(calc(100% / 0.44), 0, 0)" }], { duration: sweepMs, easing: "ease-in-out" }),
            animate(sweepText, [{ transform: "translate3d(44%, 0, 0)" }, { transform: "translate3d(-100%, 0, 0)" }], { duration: sweepMs, easing: "ease-in-out" }),
          ];
          Promise.all(current.map((a) => a.finished)).then(
            () => {
              if (state.running) timer = schedule(restMs, run);
            },
            () => undefined,
          );
        };
        run();
      },
      stop: () => {
        state.running = false;
        cancel(timer);
        current.forEach((a) => a.cancel());
        root.classList.remove("text-shimmer--active");
        root.querySelector(".text-shimmer__sweep")?.remove();
      },
    };
    shimmers.set(host, state);
    refreshShimmers();
  };
  const unshimmer = (host: HTMLElement) => {
    const s = shimmers.get(host);
    if (!s) return;
    s.stop();
    shimmers.delete(host);
    refreshShimmers();
  };

  /* Timers on the demo's own clock, so pausing holds everything. */
  const timers = new Map<number, Action>();
  let timerId = 0;
  const schedule = (delay: number, run: () => void) => {
    const id = ++timerId;
    timers.set(id, { at: clock + delay, run });
    return id;
  };
  const cancel = (id: number) => void timers.delete(id);

  /* ── State setters, each mirroring what the app renders ── */

  /** The app rounds the box 20px once the message wraps, and to a pill otherwise. */
  const roundComposer = (form: HTMLElement) => {
    const shell = form.closest<HTMLElement>(".composer-shell");
    if (shell) shell.style.borderRadius = form.classList.contains("expanded") ? `${APP_TIMING.composerExpandedRadiusPx}px` : "";
  };

  const setField = (field: HTMLElement, form: HTMLElement, submit: HTMLElement, text: string, caret: boolean) => {
    fillField(field, form, submit, text, caret);
    roundComposer(form);
  };

  const fillField = (field: HTMLElement, form: HTMLElement, submit: HTMLElement, text: string, caret: boolean) => {
    field.textContent = "";
    if (text) {
      field.append(document.createTextNode(text));
      field.removeAttribute("data-empty");
    } else field.setAttribute("data-empty", "");
    if (caret) {
      const c = document.createElement("i");
      c.className = "sd-caret";
      field.append(c);
    }
    if (!text) {
      const ph = document.createElement("span");
      ph.className = "sd-placeholder";
      ph.textContent = PLACEHOLDER;
      field.append(ph);
    }
    (submit as HTMLButtonElement).disabled = !text;
    if (!text) {
      form.classList.remove("expanded");
      return;
    }
    if (!form.classList.contains("expanded")) {
      if (field.scrollHeight > APP_TIMING.composerPillMaxPx) form.classList.add("expanded");
      return;
    }
    form.classList.remove("expanded");
    const pillHeight = field.scrollHeight;
    form.classList.add("expanded");
    if (pillHeight <= APP_TIMING.composerPillMaxPx) form.classList.remove("expanded");
  };

  const showRow = (step: number) => {
    const row = p.rows.get(step);
    if (!row) return;
    row.hidden = false;
    const cls = row.dataset.demoKind === "user" ? "event-row--user--just-sent" : "event-row--assistant--just-arrived";
    row.classList.add(cls);
    const done = (event: AnimationEvent) => {
      if (!event.animationName.endsWith("bubble-pop")) return;
      row.classList.remove(cls);
      row.removeEventListener("animationend", done);
    };
    row.addEventListener("animationend", done);
    following = true;
  };

  type IndicatorState = "vacated" | "reserved" | "shown";
  let indicatorState: IndicatorState = "vacated";
  let indicatorText = "";
  const setIndicator = (state: IndicatorState) => {
    const el = p.indicator;
    el.classList.remove("inline-working-indicator--vacated", "inline-working-indicator--reserved", "inline-working-indicator--entering");
    if (state === "vacated") {
      el.classList.add("inline-working-indicator--vacated");
      setStatus("");
    }
    if (state === "reserved") el.classList.add("inline-working-indicator--reserved");
    if (state === "shown" && indicatorState !== "shown") {
      el.classList.add("inline-working-indicator--entering");
      restart(p.indicatorBubble);
      schedule(APP_TIMING.indicatorEnterMs, () => el.classList.remove("inline-working-indicator--entering"));
      p.indicatorMark.current?.setState("thinking");
    }
    p.indicatorBubble.hidden = state !== "shown";
    indicatorState = state;
  };

  /* SwapText: the new line rises in as the old one rises out; the first line after the dots is static. */
  const setStatus = (text: string) => {
    if (text === indicatorText) return;
    const el = p.status;
    if (!text) {
      unshimmer(el);
      el.innerHTML = "";
      el.hidden = true;
      p.indicatorBubble.dataset.mode = "thinking";
      indicatorText = "";
      p.indicatorMark.current?.setState("thinking");
      return;
    }
    p.indicatorMark.current?.setState("working");
    const first = !indicatorText;
    indicatorText = text;
    p.indicatorBubble.dataset.mode = "tool";
    el.hidden = false;
    const old = el.querySelector<HTMLElement>(".swap-text__layer:not(.swap-text__layer--out)");
    if (old) {
      const oldHost = old;
      unshimmer(oldHost);
      oldHost.className = "swap-text__layer swap-text__layer--out";
      schedule(SWAP_MS, () => oldHost.remove());
    }
    const layer = document.createElement("span");
    layer.className = `swap-text__layer ${first ? "swap-text__layer--initial-static" : "swap-text__layer--in"}`;
    el.append(layer);
    shimmer(layer, text, 100);
  };

  let labelShown = false;
  const moveMark = (change: () => void) => {
    const box = p.topMarkBox;
    const before = box.getBoundingClientRect().left;
    change();
    const dx = before - box.getBoundingClientRect().left;
    if (Math.abs(dx) < 0.5) return;
    animate(box, [{ translate: `${dx}px 0` }, { translate: "0 0" }], {
      duration: ACTIVITY_INDICATOR_SETTLE_SPRING.durationMs,
      easing: springEasing(ACTIVITY_INDICATOR_SETTLE_SPRING.dampingRatio),
      composite: "add",
    });
  };
  const showTask = (title: string) => {
    labelShown = true;
    moveMark(() => {
      p.topLabel.hidden = false;
      shimmer(p.topLabel, title, 30, APP_TIMING.activityLabelShimmerMs);
    });
    animate(p.topLabel, [{ opacity: 0 }, { opacity: 1 }], {
      duration: ACTIVITY_INDICATOR_LABEL_IN_MS,
      delay: ACTIVITY_INDICATOR_LABEL_IN_DELAY_MS,
      fill: "backwards",
      easing: "ease-out",
    });
    p.topMark.current?.setState("idle");
    schedule(ACTIVITY_INDICATOR_SPAWN_BEAT_MS, () => labelShown && p.topMark.current?.setState("working"));
  };
  const settleTask = () => {
    if (!labelShown) return;
    labelShown = false;
    p.topMark.current?.setState("idle");
    animate(p.topLabel, [{ opacity: 1 }, { opacity: 0 }], { duration: ACTIVITY_INDICATOR_LABEL_OUT_MS, fill: "forwards" }).finished.then(
      () => {
        if (destroyed) return;
        moveMark(() => {
          unshimmer(p.topLabel);
          p.topLabel.hidden = true;
          p.topLabel.innerHTML = "";
        });
      },
      () => undefined,
    );
    const settle = springFrames(ACTIVITY_INDICATOR_POP_SCALE, 1, ACTIVITY_INDICATOR_POP_SETTLE_SPRING);
    animate(p.topMarkBox, [{ scale: 1 }, { scale: ACTIVITY_INDICATOR_POP_SCALE }], { duration: ACTIVITY_INDICATOR_POP_RISE_MS, easing: POP_EASE }).finished.then(
      () => {
        if (!destroyed) animate(p.topMarkBox, settle.frames.map((scale) => ({ scale })), { duration: settle.durationMs });
      },
      () => undefined,
    );
  };

  const openMenu = () => {
    const menu = p.menu;
    if (!menu) return;
    menu.hidden = false;
    animate(menu, [{ opacity: 0, transform: "translateY(-2px) scale(0.98)" }, { opacity: 1, transform: "none" }], { duration: 160, easing: SWAP_EASE });
  };
  const closeMenu = () => {
    const menu = p.menu;
    if (!menu || menu.hidden) return;
    animate(menu, [{ opacity: 1 }, { opacity: 0, transform: "translateY(-2px) scale(0.98)" }], { duration: 140, easing: "ease-in", fill: "forwards" }).finished.then(
      () => {
        if (!destroyed) menu.hidden = true;
      },
      () => undefined,
    );
  };
  const addProgress = (text: string) => {
    const list = p.progress;
    if (!list) return;
    list.querySelector("[data-newest]")?.removeAttribute("data-newest");
    const item = document.createElement("li");
    item.className = "chat-workspace-strip__task-progress-item";
    item.dataset.newest = "true";
    item.textContent = text;
    list.append(item);
  };

  const setCaption = (text: string) => {
    const host = p.caption;
    const old = host.firstElementChild as HTMLElement | null;
    if (old?.textContent === text) return;
    if (old) {
      animate(old, [{ opacity: 1, transform: "none" }, { opacity: 0, transform: "translateY(-6px)" }], { duration: SWAP_MS, easing: SWAP_EASE, fill: "forwards" }).finished.then(
        () => old.remove(),
        () => old.remove(),
      );
    }
    const line = document.createElement("span");
    line.textContent = text;
    host.append(line);
    animate(line, [{ opacity: 0, transform: "translateY(8px)" }, { opacity: 1, transform: "none" }], { duration: 420, delay: old ? 120 : 0, easing: SWAP_EASE, fill: "backwards" });
  };

  /* ── Reset to the app's empty home screen ── */

  const reset = () => {
    p.root.closest("figure")?.removeAttribute("data-armed");
    for (const row of p.rows.values()) {
      row.hidden = true;
      row.classList.remove("event-row--user--just-sent", "event-row--assistant--just-arrived");
    }
    const now = new Date();
    p.divider.textContent = fmtTime(now);
    (p.divider.parentElement as HTMLElement).hidden = true;
    p.greeting.textContent = greetingFor(now);
    p.home.hidden = false;
    p.home.classList.remove("full-body-main--home-leaving");
    p.chatLayer.classList.add("full-body-chat-layer--hidden");
    setIndicator("vacated");
    setField(p.homeField, p.homeForm, p.homeSubmit, "", false);
    setField(p.dockField, p.dockForm, p.dockSubmit, "", false);
    p.dockStop.hidden = true;
    p.topLabel.hidden = true;
    p.topLabel.innerHTML = "";
    if (p.menu) p.menu.hidden = true;
    if (p.progress) p.progress.innerHTML = "";
    if (p.taskRow) p.taskRow.dataset.status = "running";
    if (p.taskLabel) shimmer(p.taskLabel, p.taskLabel.textContent ?? "", 20);
    p.caption.innerHTML = "";
    p.scroller.scrollTop = 0;
    p.topMark.current?.setState("idle");
  };

  /* ── The plan ── */

  const readTime = (text: string) =>
    Math.max(PACE.readMin, Math.min(PACE.readMax, text.split(/\s+/).length * PACE.readPerWord));

  let t = PACE.lead;
  let firstSend = true;
  let lastSend = 0;
  let taskShown = false;
  let afterTask = false;
  steps.forEach((step, i) => {
    const next = steps[i + 1];
    if ("caption" in step) {
      const text = step.caption;
      at(Math.max(0, t - 200), () => setCaption(text));
      return;
    }
    if ("you" in step) {
      const home = firstSend;
      const field = home ? p.homeField : p.dockField;
      const form = home ? p.homeForm : p.dockForm;
      const submit = home ? p.homeSubmit : p.dockSubmit;
      const text = step.you;
      const per = Math.max(PACE.typingMinCharMs, Math.min(PACE.typingMaxCharMs, PACE.typingTotalMs / Math.max(1, text.length)));
      let k = 0;
      while (k < text.length) {
        const upTo = Math.min(text.length, k + 1 + (Math.random() < 0.3 ? 1 : 0));
        const slice = text.slice(0, upTo);
        at(t, () => setField(field, form, submit, slice, true));
        t += per * (upTo - k) * (0.7 + Math.random() * 0.6);
        k = upTo;
      }
      t += PACE.holdBeforeSend;
      at(t, () => {
        setField(field, form, submit, home ? text : "", false);
        if (home) {
          p.home.classList.add("full-body-main--home-leaving");
          schedule(APP_TIMING.homeLeaveMs, () => (p.home.hidden = true));
          p.chatLayer.classList.remove("full-body-chat-layer--hidden");
          (p.divider.parentElement as HTMLElement).hidden = false;
        }
        p.dockStop.hidden = false;
        showRow(i);
        setIndicator("reserved");
      });
      at(t + APP_TIMING.indicatorShowDelayMs, () => setIndicator("shown"));
      lastSend = t;
      firstSend = false;
      afterTask = false;
      return;
    }
    if ("stella" in step) {
      const taskNext = next && "task" in next ? next : null;
      const reply = afterTask ? t + PACE.replyAfterDone : lastSend + (taskNext ? PACE.ackAfterSend : PACE.firstReplyAfterSend);
      if (afterTask) {
        at(t + 200, () => {
          p.dockStop.hidden = false;
          setIndicator("reserved");
        });
        at(t + 200 + APP_TIMING.indicatorShowDelayMs, () => setIndicator("shown"));
      }
      const thinkingFrom = afterTask ? t + 200 : lastSend;
      if (!afterTask && reply - thinkingFrom > WORKING_INDICATOR_THINKING_LABEL_MS) {
        at(thinkingFrom + WORKING_INDICATOR_THINKING_LABEL_MS, () => setStatus(WORKING_INDICATOR_THINKING_TEXT));
      }
      if (taskNext) {
        at(reply - PACE.taskBeforeAck - 900, () => setStatus(WORK_STATUS));
        at(reply - PACE.taskBeforeAck, () => showTask(taskNext.task));
        taskShown = true;
      }
      at(reply, () => {
        setIndicator("vacated");
        p.dockStop.hidden = true;
        showRow(i);
      });
      t = reply + (taskNext ? 0 : readTime(step.stella));
      afterTask = false;
      return;
    }
    if ("task" in step) {
      if (!taskShown) {
        const title = step.task;
        at(t, () => showTask(title));
        t += PACE.taskBeforeAck;
      }
      t += PACE.menuAfterAck;
      at(t, openMenu);
      for (const row of step.rows) {
        t += PACE.rowEvery;
        at(t, () => addProgress(row));
      }
      t += PACE.doneAfterLastRow;
      at(t, () => {
        if (p.taskRow) p.taskRow.dataset.status = "completed";
        if (p.taskLabel) unshimmer(p.taskLabel);
      });
      t += PACE.menuCloseAfterDone;
      at(t, () => {
        closeMenu();
        settleTask();
      });
      afterTask = true;
      return;
    }
    if ("card" in step) {
      t += PACE.cardAfterReply;
      at(t, () => showRow(i));
      t += PACE.readMin;
    }
  });
  t += PACE.end;
  const endAt = t;
  actions.sort((a, b) => a.at - b.at);

  /* ── Clock ── */

  let next = 0;
  let status: Status = "playing";
  const setStatusOut = (s: Status) => {
    status = s;
    onStatus(s);
  };
  const frame = (now: number) => {
    if (destroyed) return;
    const dt = last ? Math.min(64, now - last) : 0;
    last = now;
    if (!paused && visible) {
      clock += dt;
      while (next < actions.length && actions[next]!.at <= clock) actions[next++]!.run();
      for (const [id, timer] of [...timers]) {
        if (timer.at <= clock) {
          timers.delete(id);
          timer.run();
        }
      }
      if (following) {
        const el = p.scroller;
        const end = el.scrollHeight - el.clientHeight;
        const gap = end - el.scrollTop;
        if (gap > 1) el.scrollTop += gap * APP_TIMING.followLerp;
        else if (gap > 0) el.scrollTop = end;
      }
      if (clock >= endAt && status === "playing") setStatusOut("done");
    }
    raf = requestAnimationFrame(frame);
  };

  const hold = (on: boolean) => {
    if (on) p.root.setAttribute("data-paused", "");
    else p.root.removeAttribute("data-paused");
    for (const animation of animations) {
      if (on) animation.pause();
      else animation.play();
    }
    for (const mark of [p.indicatorMark.current, p.topMark.current]) {
      if (on) mark?.pause();
      else mark?.resume();
    }
  };

  reset();
  if (visible) setStatusOut("playing");
  else {
    status = "idle";
    hold(true);
  }
  raf = requestAnimationFrame(frame);

  return {
    pause() {
      if (status !== "playing") return;
      paused = true;
      hold(true);
      setStatusOut("paused");
    },
    resume() {
      if (status !== "paused") return;
      paused = false;
      last = 0;
      if (visible) hold(false);
      setStatusOut("playing");
    },
    setVisible(v: boolean) {
      if (v === visible) return;
      visible = v;
      last = 0;
      if (v && status === "idle") setStatusOut("playing");
      if (!paused) hold(!v);
    },
    destroy() {
      destroyed = true;
      cancelAnimationFrame(raf);
      for (const s of shimmers.values()) s.stop();
      for (const animation of animations) animation.cancel();
      hold(false);
    },
  };
}
