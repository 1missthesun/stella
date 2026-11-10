import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { DownloadButton } from "@/components/download-button";
import { Backdrop } from "@/components/landing/backdrop";
import { Finale, LandingFooter } from "@/components/landing/closing";
import { landingFontVars } from "@/components/landing/fonts";
import { LandingHeader } from "@/components/landing/landing-header";
import l from "@/components/landing/landing.module.css";
import s from "@/components/problems/problems.module.css";
import { PRICE_LINE } from "@/lib/answers";
import {
  HOW_INDEX_PATH,
  getNiche,
  nichePages,
  nichePath,
  problemPath,
  proofLabel,
  publishedNiches,
} from "@/lib/problems";
import { getSiteUrl } from "@/lib/site-url";

export const dynamicParams = false;

const guideCount = (n: number) => (n === 1 ? "1 guide" : `${n} guides`);

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
        <div className={s.article} data-tone="light" data-bg="#ffffff">
          <header className={s.hero}>
            <nav className={s.crumbs} aria-label="Breadcrumb">
              <Link href={HOW_INDEX_PATH}>How-to</Link>
              <span aria-hidden="true">/</span>
              <span>{niche.name}</span>
            </nav>
            <h1 className={s.title}>{niche.h1}</h1>
            <p className={s.answer}>{niche.intro}</p>
            <div className={s.cta}>
              <DownloadButton />
              <span className={s.free}>{PRICE_LINE}</span>
            </div>
          </header>

          <ul className={s.list} aria-label={`${niche.name} guides`}>
            {pages.map((page) => (
              <li key={page.slug} className={s.item}>
                <Link href={problemPath(page)}>
                  <span className={s.itemTitle}>{page.h1}</span>
                  <span className={s.itemDesc}>{page.description}</span>
                  <span className={s.itemMeta}>{proofLabel(page)}</span>
                </Link>
              </li>
            ))}
          </ul>

          {others.length ? (
            <nav className={s.related} aria-labelledby="more-title">
              <h2 id="more-title" className={s.relatedTitle}>
                More how-tos
              </h2>
              <ul className={s.relatedList}>
                {others.map((other) => (
                  <li key={other.slug}>
                    <Link href={nichePath(other)}>
                      <span className={s.relatedNiche}>{guideCount(nichePages(other.slug).length)}</span>
                      {other.name}
                    </Link>
                  </li>
                ))}
              </ul>
            </nav>
          ) : null}
        </div>
        <Finale title="Let Stella do the fiddly part." note={PRICE_LINE} />
      </main>
      <LandingFooter />
    </div>
  );
}
