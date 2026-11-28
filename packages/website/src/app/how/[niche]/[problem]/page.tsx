import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Backdrop } from "@/components/landing/backdrop";
import { Finale, LandingFooter } from "@/components/landing/closing";
import { landingFontVars } from "@/components/landing/fonts";
import { LandingHeader } from "@/components/landing/landing-header";
import l from "@/components/landing/landing.module.css";
import { LinkedText } from "@/components/landing/linked-text";
import f from "@/components/landing/faq.module.css";
import { HeroMascot } from "@/components/problems/hero-mascot";
import h from "@/components/problems/how.module.css";
import { ModelStrip, PlanCallout } from "@/components/problems/model-strip";
import { BackLink, GuideGrid, HeroCta, HowTitle, PromptCard } from "@/components/problems/how-ui";
import { StellaDemo } from "@/components/stella-demo/stella-demo";
import {
  PLATFORM_NAMES,
  getNiche,
  getProblemPage,
  neighbours,
  nichePath,
  pageDemo,
  problemJsonLd,
  problemPath,
  publishedProblemPages,
  sharedFaq,
  type ProblemPage,
} from "@/lib/problems";
import { getSiteUrl } from "@/lib/site-url";

export const dynamicParams = false;

type Params = { params: Promise<{ niche: string; problem: string }> };

export function generateStaticParams() {
  return publishedProblemPages().map((page) => ({ niche: page.niche, problem: page.slug }));
}

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { niche, problem } = await params;
  const page = getProblemPage(niche, problem);
  if (!page) return {};
  const path = problemPath(page);
  return {
    title: { absolute: `${page.title} | Stella` },
    description: page.description,
    alternates: { canonical: path, types: { "text/markdown": `${path}.md` } },
    openGraph: {
      title: page.title,
      description: page.description,
      url: path,
      type: "article",
    },
    twitter: { card: "summary_large_image", title: page.title, description: page.description },
  };
}

const platformList = (page: ProblemPage) =>
  page.platforms.map((p) => PLATFORM_NAMES[p]).join(", ").replace(/, ([^,]*)$/, " and $1");

function Section({ id, title, children }: { id: string; title: string; children: React.ReactNode }) {
  return (
    <section className={h.section} aria-labelledby={`${id}-title`} id={id}>
      <div className={h.sectionHead}>
        <h2 id={`${id}-title`} className={h.h2}>
          {title}
        </h2>
      </div>
      <div>{children}</div>
    </section>
  );
}

function Stage({ page }: { page: ProblemPage }) {
  return (
    <div className={h.stage}>
      <StellaDemo steps={pageDemo(page)} label={`An example chat with Stella: ${page.h1}`} />
    </div>
  );
}

export default async function ProblemPageRoute({ params }: Params) {
  const { niche: nicheSlug, problem } = await params;
  const page = getProblemPage(nicheSlug, problem);
  const niche = getNiche(nicheSlug);
  if (!page || !niche) notFound();

  const site = getSiteUrl();
  const faq = [...page.faq, ...sharedFaq(page)];
  const near = neighbours(page, 3);

  return (
    <div className={`${l.root} ${landingFontVars}`} data-landing-root="" data-native-scroll="">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(problemJsonLd(page, site)) }} />
      <Backdrop />
      <LandingHeader />
      <main>
        <article className={h.page} data-tone="light" data-bg="#ffffff">
          <header className={h.hero} data-mascot="">
            <HeroMascot />
            <BackLink href={nichePath(niche)}>{niche.name}</BackLink>
            <HowTitle text={page.h1} />
            <p className={h.sub}>{page.lede}</p>
            <HeroCta />
            {niche.needsTopModel ? (
              <PlanCallout recommended={niche.recommended} className={h.plan} />
            ) : niche.recommended ? (
              <ModelStrip recommended={niche.recommended} className={h.models} />
            ) : null}
          </header>

          <Stage page={page} />

          <Section id="answer" title="The short answer.">
            <p className={h.answer}>
              <LinkedText text={page.answer} />
            </p>
            <p className={h.text}>Stella does this on {platformList(page)}.</p>
          </Section>

          <Section id="how" title="What you get.">
            <ol className={h.rows}>
              {page.gets.map((step) => (
                <li key={step}>
                  <LinkedText text={step} />
                </li>
              ))}
            </ol>
          </Section>

          <Section id="prompt" title="Just ask.">
            <PromptCard text={page.prompt} />
          </Section>

          <section className={f.faq} aria-labelledby="faq-title" id="faq">
            <div className={f.head}>
              <h2 id="faq-title" className={f.title}>
                Questions.
              </h2>
            </div>
            <div className={f.list}>
              {faq.map((item, i) => (
                <details key={item.q} className={f.item} open={i === 0}>
                  <summary className={f.q}>
                    <span>{item.q}</span>
                    <i className={f.icon} aria-hidden="true" />
                  </summary>
                  <div className={f.a}>
                    <p>
                      <LinkedText text={item.a} />
                    </p>
                  </div>
                </details>
              ))}
              {page.byHand?.length ? (
                <details className={f.item}>
                  <summary className={f.q}>
                    <span>Can I do it without Stella?</span>
                    <i className={f.icon} aria-hidden="true" />
                  </summary>
                  <div className={f.a}>
                    <ol>
                      {page.byHand.map((line) => (
                        <li key={line}>
                          <LinkedText text={line} />
                        </li>
                      ))}
                    </ol>
                  </div>
                </details>
              ) : null}
            </div>
          </section>

          <nav className={h.group} aria-labelledby="more-title">
            <div className={h.groupHead}>
              <h2 id="more-title" className={h.h2}>
                More guides.
              </h2>
              <Link href={nichePath(niche)} className={h.groupLink}>
                All {niche.name} guides
              </Link>
            </div>
            <GuideGrid pages={near} />
          </nav>
          <div className={h.end} />
        </article>

        <Finale />
      </main>
      <LandingFooter />
    </div>
  );
}
