import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Backdrop } from "@/components/landing/backdrop";
import { Finale, LandingFooter } from "@/components/landing/closing";
import { landingFontVars } from "@/components/landing/fonts";
import { LandingHeader } from "@/components/landing/landing-header";
import l from "@/components/landing/landing.module.css";
import { HeroMascot } from "@/components/problems/hero-mascot";
import h from "@/components/problems/how.module.css";
import { BackLink, GuideGrid, HeroCta, HowTitle } from "@/components/problems/how-ui";
import {
  HOW_INDEX_PATH,
  getNiche,
  nichePages,
  nichePath,
  problemPath,
  publishedNiches,
} from "@/lib/problems";
import { getSiteUrl } from "@/lib/site-url";

export const dynamicParams = false;

type Params = { params: Promise<{ niche: string }> };

export function generateStaticParams() {
  return publishedNiches().map((niche) => ({ niche: niche.slug }));
}

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { niche: slug } = await params;
  const niche = getNiche(slug);
  if (!niche) return {};
  const path = nichePath(niche);
  return {
    title: { absolute: `${niche.title} | Stella` },
    description: niche.description,
    alternates: { canonical: path, types: { "text/markdown": `${path}.md` } },
    openGraph: { title: niche.title, description: niche.description, url: path },
    twitter: { card: "summary_large_image", title: niche.title, description: niche.description },
  };
}

export default async function NicheHub({ params }: Params) {
  const { niche: slug } = await params;
  const niche = getNiche(slug);
  if (!niche) notFound();
  const pages = nichePages(niche.slug);
  const others = publishedNiches().filter((other) => other.slug !== niche.slug);
  const site = getSiteUrl();
  const url = new URL(nichePath(niche), site).href;
  const jsonLd = [
    {
      "@context": "https://schema.org",
      "@type": "CollectionPage",
      name: niche.title,
      description: niche.description,
      url,
      mainEntity: {
        "@type": "ItemList",
        itemListElement: pages.map((page, i) => ({
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
        { "@type": "ListItem", position: 2, name: "How-to", item: new URL(HOW_INDEX_PATH, site).href },
        { "@type": "ListItem", position: 3, name: niche.name, item: url },
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
          <header className={h.hero} data-mascot="">
            <HeroMascot />
            <BackLink href={HOW_INDEX_PATH}>All guides</BackLink>
            <HowTitle text={niche.h1} />
            <p className={h.sub}>{niche.intro.split(/(?<=\.) /)[0]}</p>
            <HeroCta />
          </header>

          <section className={h.group} aria-label={`${niche.name} guides`}>
            <GuideGrid pages={pages} />
          </section>

          {others.length ? (
            <nav className={h.group} aria-labelledby="others-title">
              <div className={h.groupHead}>
                <h2 id="others-title" className={h.h2}>
                  More guides.
                </h2>
              </div>
              <ul className={h.niches}>
                {others.map((other) => (
                  <li key={other.slug}>
                    <Link href={nichePath(other)}>{other.name}</Link>
                  </li>
                ))}
              </ul>
            </nav>
          ) : null}
          <div className={h.end} />
        </div>
        <Finale />
      </main>
      <LandingFooter />
    </div>
  );
}
