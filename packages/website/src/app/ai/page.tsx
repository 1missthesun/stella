import type { Metadata } from "next";
import Link from "next/link";
import { DownloadButton } from "@/components/download-button";
import { Backdrop } from "@/components/landing/backdrop";
import { Finale, LandingFooter } from "@/components/landing/closing";
import { landingFontVars } from "@/components/landing/fonts";
import { LandingHeader } from "@/components/landing/landing-header";
import l from "@/components/landing/landing.module.css";
import { ANSWER_GROUPS, ANSWER_PAGES, PRICE_LINE, answerTitle } from "@/lib/answers";
import { getSiteUrl } from "@/lib/site-url";
import a from "./[slug]/answer.module.css";
import x from "./index.module.css";

const TITLE = "Stella compared and explained";
const DESCRIPTION =
  "Honest comparisons of Stella (stella.sh) with the ChatGPT, Claude, Copilot and Gemini apps, and plain answers on using your ChatGPT or Claude plan on your computer.";

export const metadata: Metadata = {
  title: { absolute: `${TITLE} | Stella` },
  description: DESCRIPTION,
  alternates: { canonical: "/ai", types: { "text/markdown": "/ai.md" } },
  openGraph: {
    title: TITLE,
    description: DESCRIPTION,
    url: "/ai",
    images: [{ url: "/og/ai/index.png", width: 1200, height: 630, alt: TITLE }],
  },
  twitter: { card: "summary_large_image", title: TITLE, description: DESCRIPTION, images: ["/og/ai/index.png"] },
};

export default function AnswersIndex() {
  const site = getSiteUrl();
  const url = new URL("/ai", site).href;
  const jsonLd = [
    {
      "@context": "https://schema.org",
      "@type": "CollectionPage",
      name: TITLE,
      description: DESCRIPTION,
      url,
      mainEntity: {
        "@type": "ItemList",
        itemListElement: ANSWER_PAGES.map((page, i) => ({
          "@type": "ListItem",
          position: i + 1,
          name: page.metaTitle,
          url: new URL(`/ai/${page.slug}`, site).href,
        })),
      },
    },
    {
      "@context": "https://schema.org",
      "@type": "BreadcrumbList",
      itemListElement: [
        { "@type": "ListItem", position: 1, name: "Stella", item: site.origin },
        { "@type": "ListItem", position: 2, name: "Stella answers", item: url },
      ],
    },
  ];

  return (
    <div className={`${l.root} ${landingFontVars}`} data-landing-root="" data-native-scroll="">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }} />
      <Backdrop />
      <LandingHeader />
      <main>
        <section className={a.hero} data-tone="light" data-bg="#ffffff" aria-labelledby="index-title">
          <p className={a.eyebrow}>Stella answers</p>
          <h1 id="index-title" className={a.title}>
            Compared and explained.
          </h1>
          <p className={a.answer}>
            Stella (stella.sh) is an AI assistant for your computer that works with your files, apps and browser,
            does tasks for you, and is on your phone too. Here’s how it stacks up against the apps you know, and
            how to use the ChatGPT or Claude plan you already pay for.
          </p>
          <div className={a.cta}>
            <DownloadButton />
            <span className={a.free}>{PRICE_LINE}</span>
          </div>
        </section>

        {ANSWER_GROUPS.map((group) => (
          <section key={group.kind} className={x.group} data-tone="light" data-bg="#ffffff" aria-labelledby={`g-${group.kind}`}>
            <h2 id={`g-${group.kind}`} className={x.groupTitle}>
              {group.title}
            </h2>
            <ul className={x.list}>
              {ANSWER_PAGES.filter((page) => page.kind === group.kind).map((page) => (
                <li key={page.slug}>
                  <Link href={`/ai/${page.slug}`} className={x.item}>
                    <span className={x.itemTitle}>{answerTitle(page)}</span>
                    <span className={x.itemBody}>{page.metaDescription}</span>
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        ))}

        <Finale />
      </main>
      <LandingFooter />
    </div>
  );
}
