"use client";

import { useEffect, useRef, useState, type CSSProperties } from "react";
import { prefersReducedMotion } from "@/components/landing/motion";
import { StellaCharacter, type StellaMarkHandle } from "@/components/landing/stella-character";
import { chatItems, type DemoStep } from "@/lib/demo";
import { APP_TIMING } from "./app-timing.generated";
import { AppIcon, ChatRow, ComposerView, columnStyle, manrope, rowGap } from "./demo-view";
import { playDemo, type DemoParts, type DemoPlayer } from "./player";
import s from "./stella-demo.module.css";

type Status = "idle" | "playing" | "paused" | "done";

export function StellaDemoPlayer({ steps, theme = "dark", label }: { steps: DemoStep[]; theme?: "dark" | "light"; label: string }) {
  const items = chatItems(steps);
  const task = steps.find((step): step is Extract<DemoStep, { task: string }> => "task" in step);
  const frameRef = useRef<HTMLElement>(null);
  const parts = useRef<Partial<DemoParts>>({ rows: new Map() });
  const playerRef = useRef<DemoPlayer | null>(null);
  const indicatorMark = useRef<StellaMarkHandle | null>(null);
  const topMark = useRef<StellaMarkHandle | null>(null);
  const [status, setStatus] = useState<Status>("idle");

  useEffect(() => {
    const frame = frameRef.current;
    if (!frame) return;
    if (prefersReducedMotion()) {
      frame.removeAttribute("data-armed");
      const scroller = parts.current.scroller;
      const toEnd = () => scroller && (scroller.scrollTop = scroller.scrollHeight);
      toEnd();
      void document.fonts.ready.then(toEnd);
      return;
    }
    let inView = false;
    const start = () => {
      playerRef.current?.destroy();
      playerRef.current = playDemo(steps, { ...(parts.current as DemoParts), indicatorMark, topMark }, setStatus, inView);
    };
    start();
    const io = new IntersectionObserver(
      ([entry]) => {
        if (!entry) return;
        inView = entry.isIntersecting;
        playerRef.current?.setVisible(inView);
      },
      { threshold: 0.45 },
    );
    io.observe(frame);
    parts.current.replay = start;
    return () => {
      io.disconnect();
      playerRef.current?.destroy();
      playerRef.current = null;
    };
  }, [steps]);

  const control = () => {
    const player = playerRef.current;
    if (status === "done" || !player) parts.current.replay?.();
    else if (status === "paused") player.resume();
    else player.pause();
  };

  return (
    <figure ref={frameRef} className={s.frame} aria-label={label} suppressHydrationWarning>
      <p className={s.caption} aria-hidden="true">
        <span ref={(el) => void (parts.current.caption = el ?? undefined)} />
      </p>
      <div className={s.window} data-theme={theme}>
        <div className={`sd ${manrope.variable} ${s.sd}`} data-theme={theme} ref={(el) => void (parts.current.root = el ?? undefined)}>
          <div className="app">
            <div className={s.topbar}>
              <div className="shell-topbar-full" aria-hidden="true">
                <div className="shell-topbar-full__left">
                  <span className={s.lights} />
                  <span className="shell-topbar-tab">
                    <AppIcon name="MessageSquare" size={16} strokeWidth={1.5} />
                    Chat
                  </span>
                  <span className={s.tabPlus}>
                    <AppIcon name="Plus" size={16} strokeWidth={1.5} />
                  </span>
                </div>
                <div className="shell-topbar-activity">
                  <span className="shell-topbar-activity__trigger" ref={(el) => void (parts.current.trigger = el ?? undefined)}>
                    <span className="shell-topbar-activity__mark" ref={(el) => void (parts.current.topMarkBox = el ?? undefined)}>
                      <StellaCharacter size={APP_TIMING.activityMarkSize} eyeColor="var(--surface-base)" handleRef={topMark} />
                    </span>
                    <span className="shell-topbar-activity__label" ref={(el) => void (parts.current.topLabel = el ?? undefined)} hidden />
                  </span>
                </div>
                <div className="shell-topbar-full__right">
                  <span className={s.topIcon}>
                    <AppIcon name="Monitor" size={18} strokeWidth={1.5} />
                  </span>
                  <span className={s.topIcon}>
                    <AppIcon name="Bell" size={19} strokeWidth={1.5} />
                  </span>
                  <span className={s.topButton}>
                    <AppIcon name="SlidersHorizontal" size={18} strokeWidth={1.5} />
                    <span>Models</span>
                  </span>
                  <span className={s.topButton}>
                    <AppIcon name="Settings" size={15} strokeWidth={1.5} />
                    <span>Account</span>
                  </span>
                </div>
              </div>
            </div>

            <div className={s.body}>
              <div className="full-body-chat-layer" ref={(el) => void (parts.current.chatLayer = el ?? undefined)}>
                <div className={s.chatColumn}>
                  <div className="chat-viewport-region">
                    <div className={`session-content ${s.scroller}`} ref={(el) => void (parts.current.scroller = el ?? undefined)}>
                      <div style={columnStyle}>
                        <div className={s.list}>
                          <div className="chat-time-divider" aria-hidden="true">
                            <span ref={(el) => void (parts.current.divider = el ?? undefined)} suppressHydrationWarning>
                              Today
                            </span>
                          </div>
                          {items.map((item, i) => (
                            <ChatRow
                              key={item.step}
                              item={item}
                              gap={rowGap(items[i - 1], item)}
                              rowRef={(el) => {
                                if (el) parts.current.rows!.set(item.step, el);
                              }}
                            />
                          ))}
                          <div className="event-list-working-indicator" style={{ marginTop: APP_TIMING.rowGap } as CSSProperties} aria-hidden="true">
                            <div className="inline-working-indicator inline-working-indicator--vacated" ref={(el) => void (parts.current.indicator = el ?? undefined)}>
                              <div className="working-indicator inline-working-indicator__indicator" data-mode="thinking" ref={(el) => void (parts.current.indicatorBubble = el ?? undefined)}>
                                <div className="indicator-stella">
                                  <StellaCharacter size={APP_TIMING.indicatorMarkSize} state="thinking" eyeColor="var(--surface-base)" handleRef={indicatorMark} />
                                </div>
                                <span className="swap-text working-status" ref={(el) => void (parts.current.status = el ?? undefined)} hidden />
                              </div>
                            </div>
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                  <div className="composer-wrap">
                    <ComposerView
                      fieldRef={(el) => void (parts.current.dockField = el ?? undefined)}
                      formRef={(el) => void (parts.current.dockForm = el ?? undefined)}
                      submitRef={(el) => void (parts.current.dockSubmit = el ?? undefined)}
                    />
                  </div>
                </div>
              </div>

              <div className={`full-body-home-overlay full-body-main--home ${s.home}`} ref={(el) => void (parts.current.home = el ?? undefined)} aria-hidden="true" hidden>
                <div className="home-content">
                  <div className="home-stella-title" ref={(el) => void (parts.current.greeting = el ?? undefined)} suppressHydrationWarning>
                    Good evening
                  </div>
                  <div className="composer-wrap">
                    <ComposerView
                      fieldRef={(el) => void (parts.current.homeField = el ?? undefined)}
                      formRef={(el) => void (parts.current.homeForm = el ?? undefined)}
                      submitRef={(el) => void (parts.current.homeSubmit = el ?? undefined)}
                    />
                  </div>
                </div>
              </div>

              {task ? (
                <div
                  data-component="popover-content"
                  className={`shell-topbar-activity-menu-popover ${s.menu}`}
                  ref={(el) => void (parts.current.menu = el ?? undefined)}
                  aria-hidden="true"
                  hidden
                >
                  <div className="shell-topbar-activity-menu">
                    <div className="sidebar-search">
                      <div className="sidebar-search__body">
                        <section className="chat-workspace-strip__section">
                          <div className="chat-workspace-strip__section-body">
                            <div className={`chat-workspace-strip__task-row ${s.taskRow}`} data-status="running" ref={(el) => void (parts.current.taskRow = el ?? undefined)}>
                              <div className="chat-workspace-strip__task-row-head">
                                <span className="chat-workspace-strip__task-button">
                                  <span className="chat-workspace-strip__task-icon-wrap">
                                    <span className={s.taskIcon} data-icon="running">
                                      <AppIcon name="CircleDot" size={15} />
                                    </span>
                                    <span className={s.taskIcon} data-icon="done">
                                      <AppIcon name="CheckCircle2" size={15} />
                                    </span>
                                  </span>
                                  <span className="chat-workspace-strip__task-label" ref={(el) => void (parts.current.taskLabel = el ?? undefined)}>
                                    {task.task}
                                  </span>
                                </span>
                              </div>
                              <ul className={`chat-workspace-strip__task-progress ${s.progress}`} ref={(el) => void (parts.current.progress = el ?? undefined)} />
                            </div>
                          </div>
                        </section>
                      </div>
                    </div>
                  </div>
                </div>
              ) : null}
            </div>
          </div>
        </div>
      </div>
      <div className={s.controls} data-status={status}>
        <button type="button" className={s.control} onClick={control} disabled={status === "idle"}>
          {status === "done" ? "Play again" : status === "paused" ? "Play" : "Pause"}
        </button>
      </div>
    </figure>
  );
}
