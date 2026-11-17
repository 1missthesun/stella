import { faqJsonLd } from "@/lib/answers";
import { SECURITY_FAQ, SECURITY_PATH, SECURITY_PRICE_LINE } from "@/lib/security";
import { getSiteUrl } from "@/lib/site-url";
import f from "@/components/landing/faq.module.css";
import l from "@/components/landing/landing.module.css";
import o from "@/components/landing/closing.module.css";
import { AppWindow } from "./app-window";
import { NewsCheck } from "./news-check";
import { PrivacyMap } from "./privacy-map";
import { SecurityDownload, SecurityPlatformLinks } from "./security-download";
import s from "./security.module.css";

const CHECKS = [
  { title: "Your computer", body: "New downloads, apps that start at login, browser extensions, missed updates, disk encryption, firewall." },
  { title: "Your accounts", body: "Whether your email is in a known leak, and which of your sites had a breach." },
  { title: "Today’s news", body: "Every story checked against you. You only hear about the ones that touch you." },
];

export function WhatItDoes() {
  return (
    <section className={s.act} data-tone="light" data-bg="#f3f3f5" aria-labelledby="what-title">
      <h2 id="what-title" className={s.title}>
        One line. <span>One tap.</span>
      </h2>
      <div className={s.stage}>
        <AppWindow />
      </div>
      <ul className={s.checks}>
        {CHECKS.map((c) => (
          <li key={c.title}>
            <h3>{c.title}</h3>
            <p>{c.body}</p>
          </li>
        ))}
      </ul>
    </section>
  );
}

export function NewsAct() {
  return (
    <section className={s.act} data-tone="light" data-bg="#ffffff" aria-labelledby="news-title">
      <h2 id="news-title" className={s.title}>
        It reads <span>the news.</span>
      </h2>
      <p className={s.lede}>And tells you only when it’s about you.</p>
      <NewsCheck />
    </section>
  );
}

export function PrivacyAct() {
  return (
    <section className={s.act} data-tone="light" data-bg="#ffffff" aria-labelledby="privacy-title">
      <h2 id="privacy-title" className={s.title}>
        It stays on <span>your computer.</span>
      </h2>
      <PrivacyMap />
    </section>
  );
}

export function SecurityFaq() {
  const url = new URL(SECURITY_PATH, getSiteUrl()).href;
  return (
    <section id="faq" className={f.faq} data-tone="light" data-bg="#ffffff" aria-labelledby="faq-title">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(faqJsonLd(SECURITY_FAQ, url)) }} />
      <div className={f.head}>
        <h2 id="faq-title" className={f.title}>
          Questions.
        </h2>
      </div>
      <div className={f.list}>
        {SECURITY_FAQ.map((item, i) => (
          <details key={item.q} className={f.item} open={i === 0}>
            <summary className={f.q}>
              <span>{item.q}</span>
              <i className={f.icon} aria-hidden="true" />
            </summary>
            <div className={f.a}>
              <p>{item.a}</p>
            </div>
          </details>
        ))}
      </div>
    </section>
  );
}

/** The calm close: the app's own words, the price, and the download. */
export function SecurityFinale() {
  return (
    <section id="get" className={`${o.finale} ${l.invert}`} data-tone="dark" data-bg="#060609" aria-labelledby="get-title">
      <h2 id="get-title" className={`${o.line} ${s.finaleLine}`}>
        <i className={s.finaleDot} aria-hidden="true" />
        You’re safe.
      </h2>
      <p className={o.body}>{SECURITY_PRICE_LINE}. Sign in with your Stella account.</p>
      <div className={o.getRow}>
        <SecurityDownload />
      </div>
      <SecurityPlatformLinks className={o.stores} />
    </section>
  );
}
