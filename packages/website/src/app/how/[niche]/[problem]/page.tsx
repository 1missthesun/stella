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
import { BackLink, GuideGrid, HeroCta, HowTitle, PromptCard } from "@/components/problems/how-ui";
import { MomentList, OutputVideo, RecordingStage } from "@/components/problems/proof-video";
import {
  PLATFORM_NAMES,
  captionsPath,
  formatDate,
  formatDuration,
  getNiche,
  getProblemPage,
  neighbours,
  nichePath,
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
      ...(page.proof.kind === "video"
        ? { videos: [{ url: page.proof.video.src, width: page.proof.video.width, height: page.proof.video.height, type: "video/mp4" }] }
        : {}),
    },
    twitter: { card: "summary_large_image", title: page.title, description: page.description },
  };
}

const platformList = (page: ProblemPage) =>
  page.platforms.map((p) => PLATFORM_NAMES[p]).join(", ").replace(/, ([^,]*)$/, " and $1");

const computer = (platform: string) => {
  const name = platform.replace(/\s*\(.*\)$/, "");
  return /^(windows|mac|linux)/i.test(name) ? `a ${name} computer` : name;
};

/** One quiet sentence under the recording: when, where, which model, how it was edited. */
function madeLine(page: ProblemPage) {
  const proof = page.proof;
  if (proof.kind === "steps-only") return "";
  const parts = [`A real run on ${formatDate(proof.recordedOn)}, on ${computer(proof.platform)}, using ${proof.model}.`];
  if (proof.kind === "video") {
    const real = proof.video.realDuration ? formatDuration(proof.video.realDuration) : null;
    if (proof.video.speed && proof.video.speed > 1) parts.push(`Shown ${proof.video.speed}× faster${real ? `; it took ${real}` : ""}.`);
    else if (real) parts.push(`The waiting is sped up; it took ${real} in real time.`);
  }
  return parts.join(" ");
}

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
  const proof = page.proof;
  if (proof.kind === "video") {
    return (
      <div className={h.stage}>
        <RecordingStage
          src={proof.video.src}
          poster={proof.video.poster}
          captions={captionsPath(page)!}
          width={proof.video.width}
          height={proof.video.height}
          label={`Screen recording of Stella: ${page.h1}`}
          moments={proof.moments}
          made={madeLine(page)}
          cuts={proof.video.cuts}
        />
      </div>
    );
  }
  if (proof.kind === "shots") {
    const shot = proof.shots[0];
    return (
      <div className={h.stage}>
        <div className={h.wall}>
          <div className={h.window}>
            {/* eslint-disable-next-line @next/next/no-img-element -- proof media lives on R2, already sized */}
            <img className={h.video} src={shot.src} alt={shot.alt} width={shot.width} height={shot.height} />
          </div>
        </div>
        <p className={h.made}>{madeLine(page)}</p>
      </div>
    );
  }
  return (
    <div className={h.stage}>
      <div className={h.wall} data-tone="calm" data-prompt="">
        <PromptCard text={page.prompt} />
      </div>
      <p className={h.stageNote}>No recording of this one yet: {proof.reason.replace(/^We haven't recorded this one yet: /, "")}</p>
    </div>
  );
}

function Happened({ page }: { page: ProblemPage }) {
  const proof = page.proof;
  if (proof.kind === "steps-only") return null;
  return (
    <Section id="result" title="What happened.">
      <p className={h.result}>
        <LinkedText text={proof.result} />
      </p>
      {proof.note ? <p className={h.text}>{proof.note}</p> : null}
      {proof.kind === "video" ? <MomentList moments={proof.moments} /> : null}
      {proof.kind === "video" && proof.output ? (
        <figure className={h.figure} data-tall={proof.output.height > proof.output.width ? "" : undefined}>
          <OutputVideo
            src={proof.output.src}
            poster={proof.output.poster}
            width={proof.output.width}
            height={proof.output.height}
          />
          <figcaption>
            <LinkedText text={proof.output.caption} />
          </figcaption>
        </figure>
      ) : null}
      {(proof.kind === "video" ? (proof.shots ?? []) : proof.shots.slice(1)).map((shot) => (
        <figure key={shot.src} className={h.figure}>
          <div className={h.frame}>
            {/* eslint-disable-next-line @next/next/no-img-element -- proof media lives on R2, already sized */}
            <img src={shot.src} alt={shot.alt} width={shot.width} height={shot.height} loading="lazy" />
          </div>
          {shot.caption ? <figcaption>{shot.caption}</figcaption> : null}
        </figure>
      ))}
    </Section>
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
  const recorded = page.proof.kind !== "steps-only";

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
          </header>

          <Stage page={page} />

          <Section id="answer" title="The short answer.">
            <p className={h.answer}>
              <LinkedText text={page.answer} />
            </p>
            <p className={h.text}>Stella does this on {platformList(page)}.</p>
          </Section>

          <Happened page={page} />

          <Section id="how" title="How Stella does it.">
            <ol className={h.rows}>
              {page.stellaSteps.map((step) => (
                <li key={step}>
                  <LinkedText text={step} />
                </li>
              ))}
            </ol>
          </Section>

          {recorded ? (
            <Section id="prompt" title="The prompt.">
              <PromptCard text={page.prompt} />
              <p className={h.text}>This is the exact prompt from the recording. If your files are somewhere else, say where.</p>
            </Section>
          ) : null}

          <Section id="diy" title="Do it yourself.">
            <ol className={h.rows}>
              {page.manualSteps.map((step) => (
                <li key={step.title}>
                  <h3 className={h.rowTitle}>{step.title}</h3>
                  <p>
                    <LinkedText text={step.body} />
                  </p>
                </li>
              ))}
            </ol>
          </Section>

          <Section id="limits" title="Where it stops.">
            <ul className={h.rows} data-plain="">
              {page.limits.map((limit) => (
                <li key={limit}>
                  <LinkedText text={limit} />
                </li>
              ))}
            </ul>
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
              <ul className={h.sources} aria-label="Sources">
                {page.sources.map((source) => (
                  <li key={source.href}>
                    <a href={source.href} target="_blank" rel="noopener noreferrer">
                      {source.label}
                    </a>
                  </li>
                ))}
              </ul>
              <p className={h.checked}>Checked against these sources on {formatDate(page.lastChecked)}.</p>
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
