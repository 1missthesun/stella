import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { DownloadButton } from "@/components/download-button";
import { Backdrop } from "@/components/landing/backdrop";
import { Finale, LandingFooter } from "@/components/landing/closing";
import { landingFontVars } from "@/components/landing/fonts";
import { LandingHeader } from "@/components/landing/landing-header";
import l from "@/components/landing/landing.module.css";
import { LinkedText } from "@/components/landing/linked-text";
import {
  ANSWER_GROUPS,
  ANSWER_PAGES,
  PRICE_LINE,
  answerJsonLd,
  answerTitle,
  getAnswerPage,
  type AnswerPage as AnswerPageData,
} from "@/lib/answers";
import { getSiteUrl } from "@/lib/site-url";
import a from "./answer.module.css";
import { ChangeCardDemo } from "./change-card-demo";

export const dynamicParams = false;

export function generateStaticParams() {
  return ANSWER_PAGES.map((page) => ({ slug: page.slug }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const page = getAnswerPage(slug);
  if (!page) return {};
  const image = { url: `/og/ai/${page.slug}.png`, width: 1200, height: 630, alt: page.metaTitle };
  return {
    title: { absolute: `${page.metaTitle} | Stella` },
    description: page.metaDescription,
    alternates: {
      canonical: `/ai/${page.slug}`,
      types: { "text/markdown": `/ai/${page.slug}.md` },
    },
    openGraph: {
      title: page.metaTitle,
      description: page.metaDescription,
      url: `/ai/${page.slug}`,
      type: "article",
      images: [image],
    },
    twitter: {
      card: "summary_large_image",
      title: page.metaTitle,
      description: page.metaDescription,
      images: [image.url],
    },
  };
}

function Compare({ page }: { page: AnswerPageData }) {
  const c = page.compare;
  if (!c) return null;
  return (
    <section className={a.compare} data-tone="light" data-bg="#ffffff" aria-labelledby="compare-title">
      <h2 id="compare-title" className={a.sectionTitle}>
        Side by side.
      </h2>
      <table className={a.table}>
        <thead>
          <tr>
            <th scope="col">
              <span className={a.srOnly}>Feature</span>
            </th>
            <th scope="col" className={a.us}>
              Stella
            </th>
            <th scope="col">{c.them}</th>
          </tr>
        </thead>
        <tbody>
          {c.rows.map((row) => (
            <tr key={row.label}>
              <th scope="row">{row.label}</th>
              <td className={a.us} data-col="Stella">
                {row.stella}
              </td>
              <td data-col={c.them}>{row.them}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className={a.pick}>
        <div>
          <h3>{c.pickThem ?? `Pick the ${c.them} if`}</h3>
          <ul>
            {c.themBetter.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </div>
        <div>
          <h3>Pick Stella if</h3>
          <ul>
            {c.stellaBetter.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </div>
      </div>
      <p className={a.checked}>
        {c.checked} Sources:{" "}
        {c.sources.map((source, i) => (
          <span key={source.href}>
            {i > 0 ? ", " : null}
            <a href={source.href} target="_blank" rel="noopener noreferrer">
              {source.label}
            </a>
          </span>
        ))}
        .
      </p>
    </section>
  );
}

function Steps({ page }: { page: AnswerPageData }) {
  if (!page.steps?.length) return null;
  return (
    <section className={a.steps} data-tone="light" data-bg="#ffffff" aria-labelledby="steps-title">
      <h2 id="steps-title" className={a.sectionTitle}>
        {page.stepsTitle ?? "How to do it."}
      </h2>
      <ol className={a.stepList}>
        {page.steps.map((step, i) => (
          <li key={step.title}>
            <span className={a.stepNo}>{String(i + 1).padStart(2, "0")}</span>
            <div>
              <h3>{step.title}</h3>
              <p>
                <LinkedText text={step.body} />
              </p>
            </div>
          </li>
        ))}
      </ol>
    </section>
  );
}

export default async function AnswerPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const page = getAnswerPage(slug);
  if (!page) notFound();

  const jsonLd = answerJsonLd(page, getSiteUrl());
  const groups = ANSWER_GROUPS.map((group) => ({
    ...group,
    pages: ANSWER_PAGES.filter((other) => other.kind === group.kind && other.slug !== page.slug),
  })).filter((group) => group.pages.length > 0);

  return (
    <div className={`${l.root} ${landingFontVars}`} data-landing-root="" data-native-scroll="">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }} />
      <Backdrop />
      <LandingHeader />
      <main>
        <section className={a.hero} data-tone="light" data-bg="#ffffff" aria-labelledby="answer-title">
          <nav className={a.crumbs} aria-label="Breadcrumb">
            <Link href="/ai">Stella answers</Link>
            <span aria-hidden="true">/</span>
            <span>{page.eyebrow}</span>
          </nav>
          <h1 id="answer-title" className={a.title} data-long={page.headline.length > 34 ? "" : undefined}>
            {page.headline}
          </h1>
          <p className={a.answer}>
            <LinkedText text={page.answer} />
          </p>
          <div className={a.cta}>
            <DownloadButton />
            <span className={a.free}>{page.answer.includes(PRICE_LINE) ? "No credit card." : PRICE_LINE}</span>
          </div>
        </section>

        {page.visual === "change-card" ? (
          <section className={a.visual} data-tone="light" data-bg="#ffffff" aria-label="A change to Stella, in the chat">
            <ChangeCardDemo />
          </section>
        ) : null}

        <Compare page={page} />
        <Steps page={page} />

        {page.points?.length ? (
          <section className={a.points} data-tone="light" data-bg="#ffffff" aria-label="What Stella does">
            {page.points.map((point) => (
              <div key={point.title} className={a.point}>
                <h2>{point.title}</h2>
                <p>
                  <LinkedText text={point.body} />
                </p>
              </div>
            ))}
          </section>
        ) : null}

        <section className={a.qa} data-tone="light" data-bg="#ffffff" aria-labelledby="answer-questions">
          <h2 id="answer-questions" className={a.qaTitle}>
            Questions.
          </h2>
          <div className={a.qaList}>
            {page.questions.map((item) => (
              <div key={item.q} className={a.qaItem}>
                <h3>{item.q}</h3>
                <p>
                  <LinkedText text={item.a} />
                </p>
              </div>
            ))}
            <Link href="/#faq" className={a.qaMore}>
              More questions
            </Link>
          </div>
        </section>

        <nav className={a.more} data-tone="light" data-bg="#ffffff" aria-label="More about Stella">
          {groups.map((group) => (
            <div key={group.kind} className={a.moreGroup}>
              <p className={a.moreTitle}>{group.title}</p>
              {group.pages.map((other) => (
                <Link key={other.slug} href={`/ai/${other.slug}`}>
                  {answerTitle(other)}
                </Link>
              ))}
            </div>
          ))}
        </nav>

        <Finale />
      </main>
      <LandingFooter />
    </div>
  );
}
