import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowRight, Check, Search } from "lucide-react";
import { CopyPromptButton } from "@/components/copy-prompt-button";
import { DownloadButton } from "@/components/download-button";
import { WindowsInstallNote } from "@/components/windows-install-note";
import { Her, Me, MockChat, MockStage } from "@/components/landing/chat-mock";
import { Finale } from "@/components/landing/closing";
import { InView } from "@/components/landing/in-view";
import { PageShell } from "@/components/landing/page-shell";
import pg from "@/components/landing/page.module.css";
import { getFixPageDemo } from "@/lib/fix-page-demos";
import { FIX_PAGES, getFixPage } from "@/lib/fix-pages";
import f from "../fix.module.css";

export const dynamicParams = false;

export function generateStaticParams() {
  return FIX_PAGES.map((page) => ({ slug: page.slug }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const page = getFixPage(slug);
  if (!page) return {};
  return {
    title: page.metaTitle,
    description: page.metaDescription,
    alternates: { canonical: `/fix/${page.slug}` },
  };
}

const BEATS = [
  "You describe the problem in your own words.",
  "Stella uses your apps, browser, and files.",
  "You watch every step. Destructive work waits.",
];

export default async function FixPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const page = getFixPage(slug);
  if (!page) notFound();
  const exchanges = getFixPageDemo(page.slug);

  return (
    <PageShell
      closing={
        <Finale
          title={page.ctaHeadline}
          body="Download Stella for Mac or Windows and tell it what's broken."
          actions={<Link href="/fix">More things Stella fixes</Link>}
          note="Free. No credit card, no trial."
          after={<WindowsInstallNote />}
        />
      }
    >
      <section className={pg.hero} data-tone="light" data-bg="#ffffff">
        <p className={pg.eyebrow}>{page.eyebrow}</p>
        <h1 className={`${pg.title} ${f.title}`}>
          {page.headline} <em>{page.headlineAccent}</em>
        </h1>
        <p className={pg.lede}>{page.lede}</p>
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

      <section className={f.symptomsSection} data-tone="light" data-bg="#f1f1f4" aria-labelledby="familiar">
        <div className={f.sectionHead}>
          <p className={pg.eyebrow}>Sound familiar?</p>
          <h2 id="familiar" className={pg.h2}>
            You&apos;ve probably already searched this.
          </h2>
        </div>
        <InView className={f.searches} threshold={0.1}>
          {page.symptoms.map((symptom, i) => (
            <p key={symptom} className={f.search} style={{ ["--i" as string]: i }}>
              <Search size={18} strokeWidth={2} aria-hidden="true" />
              <span>{symptom}</span>
            </p>
          ))}
        </InView>
      </section>

      <section className={pg.split} data-tone="light" data-bg="#ffffff" aria-labelledby="how">
        <div className={pg.copy}>
          <p className={pg.eyebrow}>How it works</p>
          <h2 id="how" className={pg.h2}>
            Tell Stella. It works your computer. Done.
          </h2>
          <ol className={f.beats}>
            {BEATS.map((beat, i) => (
              <li key={beat}>
                <span>{i + 1}</span>
                {beat}
              </li>
            ))}
          </ol>
          <div className={f.prompt}>
            <div className={f.promptTop}>
              <span className={f.promptLabel}>Try this prompt</span>
              <CopyPromptButton text={page.prompt} className={f.copy} />
            </div>
            <q className={f.promptText}>{page.prompt}</q>
          </div>
        </div>
        {exchanges.length > 0 ? (
          <MockStage>
            <MockChat>
              {exchanges.flatMap((exchange, i) => [
                <Me key={`u${i}`} d={i * 1400}>
                  {exchange.user}
                </Me>,
                <Her key={`r${i}`} d={i * 1400 + 600}>
                  {exchange.reply}
                </Her>,
              ])}
            </MockChat>
          </MockStage>
        ) : null}
      </section>

      <section className={f.doesSection} data-tone="light" data-bg="#f1f1f4" aria-labelledby="does">
        <div className={f.sectionHead}>
          <p className={pg.eyebrow}>On this problem</p>
          <h2 id="does" className={pg.h2}>
            What Stella actually does.
          </h2>
        </div>
        <InView className={f.does} threshold={0.1}>
          {page.steps.map((step, i) => (
            <div key={step} className={f.step} style={{ ["--i" as string]: i }}>
              <span className={f.stepIcon}>
                <Check size={18} strokeWidth={2.6} aria-hidden="true" />
              </span>
              <p>{step}</p>
            </div>
          ))}
        </InView>
      </section>
    </PageShell>
  );
}
