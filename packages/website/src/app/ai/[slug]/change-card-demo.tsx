"use client";

import { useEffect, useRef, useState } from "react";
import d from "./change-card-demo.module.css";

// A recreation of Stella's in-chat change card: the request, the card
// with Update, then the applied change (new sidebar button) with Undo.
export function ChangeCardDemo() {
  const ref = useRef<HTMLDivElement>(null);
  const [done, setDone] = useState(false);

  useEffect(() => {
    const node = ref.current;
    if (!node) return;
    const delay = window.matchMedia("(prefers-reduced-motion: reduce)").matches ? 0 : 1800;
    let timer = 0;
    const io = new IntersectionObserver(
      ([entry]) => {
        if (!entry?.isIntersecting) return;
        io.disconnect();
        timer = window.setTimeout(() => setDone(true), delay);
      },
      { threshold: 0.55 },
    );
    io.observe(node);
    return () => {
      io.disconnect();
      window.clearTimeout(timer);
    };
  }, []);

  return (
    <div ref={ref} className={d.window} data-done={done ? "" : undefined}>
      <div className={d.bar} aria-hidden="true">
        <i />
        <i />
        <i />
        <span>Stella</span>
      </div>
      <div className={d.body}>
        <aside className={d.side} aria-label="Stella sidebar">
          <span className={d.sideItem} data-on="">
            Chat
          </span>
          <span className={d.sideItem}>Files</span>
          <span className={d.sideItem}>Reminders</span>
          <span className={d.newItem} aria-hidden={!done}>
            <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true">
              <path d="M3 7h6l2 2h10v10H3z" fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" />
            </svg>
            Tidy Downloads
          </span>
        </aside>
        <div className={d.chat}>
          <p className={d.user}>Add a button to my sidebar that tidies my Downloads folder.</p>
          <p className={d.reply}>Here it is. It sorts Downloads into folders by type and clears installers you’ve already run.</p>
          <div className={d.card} data-tone={done ? "done" : "update"}>
            <span className={d.icon} aria-hidden="true">
              {done ? (
                <svg viewBox="0 0 24 24" width="16" height="16">
                  <path d="M20 6 9 17l-5-5" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              ) : (
                <svg viewBox="0 0 24 24" width="16" height="16">
                  <path
                    d="M21 12a9 9 0 0 1-15.5 6.2M3 12a9 9 0 0 1 15.5-6.2M21 4v5h-5M3 20v-5h5"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
              )}
            </span>
            <span className={d.text}>
              <span className={d.cardTitle}>Add a Tidy Downloads button</span>
              <span className={d.detail}>{done ? "Updated just now" : "Changes to Stella · 3 files"}</span>
            </span>
            <span className={d.button} data-primary={done ? undefined : ""}>
              {done ? "Undo" : "Update"}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
