"use client";

import { useRef, type CSSProperties, type ReactNode } from "react";
import { useInViewOnce } from "./motion";
import { WindowBar, WindowFrame } from "./skins";
import type { WindowThemeKey } from "./window-theme";
import s from "./skins.module.css";
import c from "./chat-mock.module.css";

function delay(d?: number): CSSProperties | undefined {
  return d === undefined ? undefined : ({ ["--d" as string]: `${d}ms` } as CSSProperties);
}

export function MockStage({
  children,
  className,
  dark = false,
}: {
  children: ReactNode;
  className?: string;
  dark?: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useInViewOnce(ref, 0.35);
  return (
    <div ref={ref} className={[c.stage, className].filter(Boolean).join(" ")} data-variant={dark ? "dark" : "light"} aria-hidden="true">
      {children}
    </div>
  );
}

export function MockChat({
  theme = { id: "default", dark: false },
  status,
  typed,
  placeholder = "Do anything",
  typedAt = 0,
  composer,
  children,
}: {
  composer?: ReactNode;
  theme?: WindowThemeKey;
  status?: ReactNode;
  typed?: string;
  placeholder?: string;
  typedAt?: number;
  children: ReactNode;
}) {
  return (
    <div className={c.window}>
      <WindowFrame theme={theme}>
        <WindowBar status={status} compact />
        <div className={c.column}>
          <div className={c.thread}>{children}</div>
          {composer ?? (
          <div className={s.composer}>
            <span className={s.plus}>
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <path d="M12 5v14M5 12h14" />
              </svg>
            </span>
            {typed ? (
              <span className={c.typed} style={{ ...delay(typedAt), ["--n" as string]: typed.length }}>
                {typed}
              </span>
            ) : (
              <span className={s.placeholder}>{placeholder}</span>
            )}
            <svg className={s.mic} viewBox="0 0 24 24" aria-hidden="true">
              <rect x="9" y="3" width="6" height="11" rx="3" />
              <path d="M5 11a7 7 0 0 0 14 0M12 18v3" />
            </svg>
            <span className={s.send}>
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <path d="M12 19V5M6 11l6-6 6 6" />
              </svg>
            </span>
          </div>
          )}
        </div>
      </WindowFrame>
    </div>
  );
}

export function Me({ children, d }: { children: ReactNode; d?: number }) {
  return (
    <p className={`${c.step} ${s.me}`} style={delay(d)}>
      {children}
    </p>
  );
}

export function Her({ children, d }: { children: ReactNode; d?: number }) {
  return (
    <div className={`${c.step} ${s.her} ${c.her}`} style={delay(d)}>
      {children}
    </div>
  );
}

export function Stamp({ children, d }: { children: ReactNode; d?: number }) {
  return (
    <p className={`${c.step} ${s.stamp}`} style={delay(d)}>
      {children}
    </p>
  );
}

const STAR = "M12 2 C12.9 8.2 15.8 11.1 22 12 C15.8 12.9 12.9 15.8 12 22 C11.1 15.8 8.2 12.9 2 12 C8.2 11.1 11.1 8.2 12 2 Z";

export function Task({ label, d, doneAt }: { label: string; d?: number; doneAt?: number }) {
  return (
    <div
      className={`${c.step} ${c.task}`}
      data-done={doneAt === undefined ? "never" : "later"}
      style={{ ...delay(d), ["--done" as string]: `${doneAt ?? 0}ms` }}
    >
      <span className={c.glyph}>
        <svg className={c.star} viewBox="0 0 24 24" aria-hidden="true">
          <path d={STAR} />
        </svg>
        <svg className={c.check} viewBox="0 0 24 24" aria-hidden="true">
          <path d="M5 12.5l4.5 4.5L19 7.5" />
        </svg>
      </span>
      <span className={c.taskLabel}>{label}</span>
      <span className={c.taskState}>
        <em className={c.running}>running</em>
        <em className={c.done}>done</em>
      </span>
    </div>
  );
}

export function Card({
  icon,
  title,
  meta,
  d,
}: {
  icon: ReactNode;
  title: ReactNode;
  meta?: ReactNode;
  d?: number;
}) {
  return (
    <div className={`${c.step} ${c.card}`} style={delay(d)}>
      <span className={c.cardIcon}>{icon}</span>
      <span className={c.cardText}>
        <b>{title}</b>
        {meta ? <small>{meta}</small> : null}
      </span>
    </div>
  );
}
