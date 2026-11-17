"use client";

import { useRef } from "react";
import { useInViewOnce } from "@/components/landing/motion";
import p from "./privacy-map.module.css";

const STAYS = ["Browsing history", "Files", "Downloads", "Apps", "Extensions", "Settings"];

const LEAVES = [
  { what: "Your email address", why: "to check it against known leaks" },
  { what: "A short description of one suspicious item", why: "to ask about it" },
];

/** What's checked on the computer and stays there, and the two things that leave. */
export function PrivacyMap() {
  const ref = useRef<HTMLDivElement>(null);
  useInViewOnce(ref, 0.35);

  return (
    <div ref={ref} className={p.map}>
      <figure className={p.computer} aria-label="Checked on your computer, never sent">
        <div className={p.screen}>
          <p className={p.screenTitle}>Checked here. Never sent.</p>
          <ul className={p.stays}>
            {STAYS.map((item, i) => (
              <li key={item} style={{ transitionDelay: `${120 + i * 70}ms` }}>
                {item}
              </li>
            ))}
          </ul>
        </div>
        <div className={p.base} aria-hidden="true" />
      </figure>

      <div className={p.out}>
        <i className={p.wire} aria-hidden="true" />
        <p className={p.outTitle}>All that leaves</p>
        <ul className={p.leaves}>
          {LEAVES.map((item, i) => (
            <li key={item.what} style={{ transitionDelay: `${900 + i * 260}ms` }}>
              <strong>{item.what}</strong>
              <span>{item.why}</span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
