import type { Metadata } from "next";
import Link from "next/link";
import { Backdrop } from "@/components/landing/backdrop";
import { Finale, LandingFooter } from "@/components/landing/closing";
import { landingFontVars } from "@/components/landing/fonts";
import { LandingHeader } from "@/components/landing/landing-header";
import l from "@/components/landing/landing.module.css";
import h from "@/components/problems/how.module.css";
import { GuideGrid, HeroCta, HowTitle } from "@/components/problems/how-ui";
import { HOW_INDEX_PATH, nichePages, nichePath, problemPath, publishedNiches, publishedProblemPages } from "@/lib/problems";
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
        <div className={h.page} data-tone="light" data-bg="#ffffff">
          <header className={h.hero}>
            <HowTitle text="Stuck? Here’s how." />
            <p className={h.sub}>The free way to fix it yourself, and a real recording of Stella doing it for you.</p>
            <HeroCta />
          </header>

          {niches.map((niche) => {
            const pages = nichePages(niche.slug);
            return (
              <section key={niche.slug} className={h.group} aria-labelledby={`niche-${niche.slug}`}>
                <div className={h.groupHead}>
                  <h2 id={`niche-${niche.slug}`} className={h.h2}>
                    {niche.name}.
                  </h2>
                  <Link href={nichePath(niche)} className={h.groupLink}>
                    {pages.length === 1 ? "Open the guide" : `All ${pages.length} guides`}
                  </Link>
                </div>
                <GuideGrid pages={pages} />
              </section>
            );
          })}
          <div className={h.end} />
        </div>
        <Finale />
      </main>
      <LandingFooter />
    </div>
  );
}
