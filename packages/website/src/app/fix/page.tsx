import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { DownloadButton } from "@/components/download-button";
import { WindowsInstallNote } from "@/components/windows-install-note";
import { Finale } from "@/components/landing/closing";
import { InView } from "@/components/landing/in-view";
import { PageShell } from "@/components/landing/page-shell";
import pg from "@/components/landing/page.module.css";
import { FIX_PAGES } from "@/lib/fix-pages";
import f from "./fix.module.css";

export const metadata: Metadata = {
  title: "Things Stella just fixes",
  description:
    "Broken apps, full disks, mod chaos, spreadsheet drudgery — Stella is an AI assistant that can work with your apps and files to help fix it.",
  alternates: { canonical: "/fix" },
};

export default function FixIndexPage() {
  return (
    <PageShell closing={<Finale />}>
      <section className={pg.hero} data-tone="light" data-bg="#ffffff">
        <p className={pg.eyebrow}>Fix it with Stella</p>
        <h1 className={pg.title}>
          Whatever broke, <em>tell Stella.</em>
        </h1>
        <p className={pg.lede}>
          Stella is an AI assistant that can use your computer through the desktop app — apps, browser, files. Pick
          your problem below, or just download it and describe what&apos;s wrong in your own words.
        </p>
        <div className={pg.cta}>
          <DownloadButton />
          <Link className={pg.secondary} href="/pricing">
            See pricing
            <ArrowRight size={16} />
          </Link>
        </div>
        <div className={pg.note}>
          <WindowsInstallNote />
        </div>
        <p className={pg.reassure}>Free to use</p>
      </section>

      <section className={f.index} data-tone="light" data-bg="#f1f1f4" aria-label="Problems Stella fixes">
        <InView className={f.grid} threshold={0.02}>
          {FIX_PAGES.map((page, i) => (
            <Link
              key={page.slug}
              className={f.card}
              href={`/fix/${page.slug}`}
              style={{ ["--i" as string]: Math.min(i, 8) }}
            >
              <span className={f.cardTag}>{page.eyebrow.replace(/^Fix it with Stella\s*·\s*/, "")}</span>
              <h2>
                {page.headline} <em>{page.headlineAccent}</em>
              </h2>
              <p>{page.metaDescription}</p>
              <span className={f.go}>
                Fix it
                <ArrowRight size={14} aria-hidden="true" />
              </span>
            </Link>
          ))}
        </InView>
      </section>
    </PageShell>
  );
}
