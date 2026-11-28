import Link from "next/link";
import f from "@/components/landing/faq.module.css";
import { LinkedText } from "@/components/landing/linked-text";
import h from "@/components/problems/how.module.css";
import { BackLink, GuideGrid, HeroCta, HowTitle } from "@/components/problems/how-ui";
import { HeroMascot } from "@/components/problems/hero-mascot";
import { ModelStrip, PlanCallout } from "@/components/problems/model-strip";
import { StellaDemo } from "@/components/stella-demo/stella-demo";
import { ANSWER_PAGES, answerTitle, type AnswerPage } from "@/lib/answers";
import { demoFrom } from "@/lib/demo";
import { getNiche, getProblemById, nichePath, type ProblemPage } from "@/lib/problems";

export function ModelAnswerPage({ page }: { page: AnswerPage }) {
  const demo = page.demo;
  const guides = (page.guides ?? []).map(getProblemById).filter((g): g is ProblemPage => Boolean(g));
  const niche = guides[0] ? getNiche(guides[0].niche) : undefined;

  return (
    <article className={h.page} data-tone="light" data-bg="#ffffff">
      <header className={h.hero} data-mascot="">
        <HeroMascot />
        <BackLink href="/ai">Stella answers</BackLink>
        <HowTitle text={page.headline} />
        {page.lede ? <p className={h.sub}>{page.lede}</p> : null}
        <HeroCta />
        {page.planCallout ? (
          <PlanCallout recommended={page.recommended} body={niche?.planBody} className={h.plan} />
        ) : (
          <ModelStrip recommended={page.recommended} className={h.models} />
        )}
      </header>

      {demo ? (
        <div className={h.stage}>
          <StellaDemo steps={demoFrom(demo)} label={`An example chat with Stella: ${page.headline}`} />
        </div>
      ) : null}

      <section className={h.section} aria-labelledby="answer-title" id="answer">
        <div className={h.sectionHead}>
          <h2 id="answer-title" className={h.h2}>
            The short answer.
          </h2>
        </div>
        <div>
          <p className={h.answer}>
            <LinkedText text={page.answer} />
          </p>
        </div>
      </section>

      {page.why?.length ? (
        <section className={h.section} aria-labelledby="why-title" id="why">
          <div className={h.sectionHead}>
            <h2 id="why-title" className={h.h2}>
              Better than a browser chat.
            </h2>
          </div>
          <div className={h.whyList}>
            {page.why.map((item) => (
              <div key={item.title} className={h.why}>
                <h3>{item.title}</h3>
                <p>
                  <LinkedText text={item.body} />
                </p>
              </div>
            ))}
          </div>
        </section>
      ) : null}

      {guides.length ? (
        <nav className={h.group} aria-labelledby="guides-title">
          <div className={h.groupHead}>
            <h2 id="guides-title" className={h.h2}>
              Just ask, like this.
            </h2>
            {niche ? (
              <Link href={nichePath(niche)} className={h.groupLink}>
                All {niche.name} guides
              </Link>
            ) : null}
          </div>
          <GuideGrid pages={guides} />
        </nav>
      ) : null}

      <section className={f.faq} aria-labelledby="faq-title" id="faq">
        <div className={f.head}>
          <h2 id="faq-title" className={f.title}>
            Questions.
          </h2>
        </div>
        <div className={f.list}>
          {page.questions.map((item, i) => (
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
        </div>
      </section>
      <nav className={h.group} aria-labelledby="more-title">
        <div className={h.groupHead}>
          <h2 id="more-title" className={h.h2}>
            More.
          </h2>
        </div>
        <ul className={h.niches}>
          {ANSWER_PAGES.filter((other) => other.kind === "model" && other.slug !== page.slug).map((other) => (
            <li key={other.slug}>
              <Link href={`/ai/${other.slug}`}>{answerTitle(other)}</Link>
            </li>
          ))}
        </ul>
      </nav>
      <div className={h.end} />
    </article>
  );
}
