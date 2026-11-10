import type { Metadata } from "next";
import Link from "next/link";
import { DownloadButton } from "@/components/download-button";
import { Backdrop } from "@/components/landing/backdrop";
import { Finale, LandingFooter } from "@/components/landing/closing";
import { landingFontVars } from "@/components/landing/fonts";
import { LandingHeader } from "@/components/landing/landing-header";
import l from "@/components/landing/landing.module.css";
import s from "@/components/problems/problems.module.css";
import { PRICE_LINE } from "@/lib/answers";
import { HOW_INDEX_PATH, nichePages, nichePath, problemPath, proofLabel, publishedNiches, publishedProblemPages } from "@/lib/problems";
import { getSiteUrl } from "@/lib/site-url";

const TITLE = "How to do it: step-by-step guides";
const DESCRIPTION =
  "Specific problems, answered properly: Minecraft mods, video edits, messy folders and PDFs to Excel. The manual steps, and Stella (stella.sh) doing it on a real computer.";

export const metadata: Metadata = {
  title: { absolute: `${TITLE} | Stella` },
  description: DESCRIPTION,
  alternates: { canonical: HOW_INDEX_PATH, types: { "text/markdown": `${HOW_INDEX_PATH}.md` } },
  openGraph: {
    title: TITLE,
    description: DESCRIPTION,
    url: HOW_INDEX_PATH,
  },
  twitter: { card: "summary_large_image", title: TITLE, description: DESCRIPTION },
};

export default function HowIndex() {
  const site = getSiteUrl();
  const url = new URL(HOW_INDEX_PATH, site).href;
  const niches = publishedNiches();
  const jsonLd = [
    {
      "@context": "https://schema.org",
      "@type": "CollectionPage",
      name: TITLE,
      description: DESCRIPTION,
      url,
      mainEntity: {
        "@type": "ItemList",
        itemListElement: publishedProblemPages().map((page, i) => ({
          "@type": "ListItem",
          position: i + 1,
          name: page.title,
          url: new URL(problemPath(page), site).href,
        })),
      },
    },
    {
      "@context": "https://schema.org",
      "@type": "BreadcrumbList",
      itemListElement: [
        { "@type": "ListItem", position: 1, name: "Stella", item: site.origin },
        { "@type": "ListItem", position: 2, name: "How-to", item: url },
      ],
    },
  ];

  return (
    <div className={`${l.root} ${landingFontVars}`} data-landing-root="" data-native-scroll="">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }} />
      <Backdrop />
      <LandingHeader />
      <main>
        <div className={s.article} data-tone="light" data-bg="#ffffff">
          <header className={s.hero}>
            <p className={s.eyebrow}>How-to</p>
            <h1 className={s.title}>Your problem, answered properly.</h1>
            <p className={s.answer}>
              Each guide gives you the manual way first, then shows Stella (stella.sh) doing the same job on a real
              computer, with the prompt to paste and what it won’t do.
            </p>
            <div className={s.cta}>
              <DownloadButton />
              <span className={s.free}>{PRICE_LINE}</span>
            </div>
          </header>

          {niches.map((niche) => (
            <section key={niche.slug} className={s.nicheGroup} aria-labelledby={`niche-${niche.slug}`}>
              <div className={s.nicheHead}>
                <h2 id={`niche-${niche.slug}`}>{niche.name}</h2>
                <Link href={nichePath(niche)}>All {niche.name} guides</Link>
              </div>
              <ul className={s.list}>
                {nichePages(niche.slug).map((page) => (
                  <li key={page.slug} className={s.item}>
                    <Link href={problemPath(page)}>
                      <span className={s.itemTitle}>{page.h1}</span>
                      <span className={s.itemDesc}>{page.description}</span>
                      <span className={s.itemMeta}>{proofLabel(page)}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
        <Finale title="Let Stella do the fiddly part." note={PRICE_LINE} />
      </main>
      <LandingFooter />
    </div>
  );
}
