import type { Metadata } from "next";
import {
  changelogEntries,
  type ChangeItem,
  type ChangelogEntry,
} from "../changelog-entries";
import Link from "next/link";
import { PageShell } from "@/components/landing/page-shell";
import pg from "@/components/landing/page.module.css";
import w from "./whats-new.module.css";

export const metadata: Metadata = {
  title: "What's New",
  description:
    "Every Stella release, in plain English. Each version's highlights up top, the rest tucked just below.",
  alternates: { canonical: "/learn-more/whats-new" },
};

function entryKey(entry: ChangelogEntry): string {
  return `${entry.release ?? entry.era ?? "entry"}-${entry.date}`;
}

function entryHeadline(entry: ChangelogEntry): string {
  return entry.release ?? entry.era ?? entry.date;
}

function ChangeRow({ item }: { item: ChangeItem }) {
  if (typeof item === "string") {
    return <li>{item}</li>;
  }
  return (
    <li>
      <span className={w.product} aria-label={`${item.product} update`}>
        {item.product}
      </span>
      {item.text}
    </li>
  );
}

export default function WhatsNew() {
  return (
    <PageShell>
      <section className={pg.hero} data-tone="light" data-bg="#ffffff">
        <p className={pg.eyebrow}>
          <Link href="/learn-more" className={w.crumb}>
            Learn more
          </Link>{" "}
          / What&apos;s new
        </p>
        <h1 className={pg.title}>
          Every release, <em>in plain English.</em>
        </h1>
        <p className={pg.lede}>
          Stella ships in small, frequent releases. Each entry below headlines the version that shipped, with the
          highlights up top and the rest tucked just behind &ldquo;More in this release.&rdquo;
        </p>
      </section>

      <section className={w.log} data-tone="light" data-bg="#ffffff" aria-label="Releases">
        <ol>
          {changelogEntries.map((entry) => {
            const highlights = entry.highlights ?? [];
            const more = entry.more ?? [];
            return (
              <li key={entryKey(entry)} className={w.entry}>
                <div className={w.meta}>
                  <span className={w.release}>{entryHeadline(entry)}</span>
                  <span className={w.date}>{entry.date}</span>
                  {entry.tags && entry.tags.length > 0 ? (
                    <span className={w.tags}>
                      {entry.tags.map((tag) => (
                        <span key={tag} className={w.tag} data-tag={tag}>
                          {tag}
                        </span>
                      ))}
                    </span>
                  ) : null}
                </div>
                <div className={w.body}>
                  {highlights.length > 0 ? (
                    <ul className={w.highlights}>
                      {highlights.map((item, idx) => (
                        <ChangeRow key={`h-${idx}`} item={item} />
                      ))}
                    </ul>
                  ) : null}
                  {more.length > 0 ? (
                    <details className={w.more}>
                      <summary>
                        <span>More in this release</span>
                        <span className={w.count}>{more.length}</span>
                        <i className={w.icon} aria-hidden="true" />
                      </summary>
                      <ul className={w.moreList}>
                        {more.map((item, idx) => (
                          <ChangeRow key={`m-${idx}`} item={item} />
                        ))}
                      </ul>
                    </details>
                  ) : null}
                </div>
              </li>
            );
          })}
        </ol>
      </section>
    </PageShell>
  );
}
