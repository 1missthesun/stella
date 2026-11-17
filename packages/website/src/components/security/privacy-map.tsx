"use client";

import { useRef } from "react";
import { useInViewOnce } from "@/components/landing/motion";
import p from "./privacy-map.module.css";

const STAYS = ["Browsing history", "Files", "Saved passwords", "Sites you log in to", "Settings", "Everyday email"];

const LEAVES = [
  { what: "Your email address", why: "to check it against known leaks" },
  { what: "Names of new apps, extensions and downloads", why: "for a model to judge, once each" },
  { what: "Suspicious-looking emails: sender, subject, a snippet", why: "only if you connect email" },
];

/** What's checked on the computer and stays there, and the few things that leave. */
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
