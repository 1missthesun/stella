import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { CopyPromptButton } from "@/components/copy-prompt-button";
import { DownloadButton } from "@/components/download-button";
import { Backdrop } from "@/components/landing/backdrop";
import { Finale, LandingFooter } from "@/components/landing/closing";
import { landingFontVars } from "@/components/landing/fonts";
import { LandingHeader } from "@/components/landing/landing-header";
import l from "@/components/landing/landing.module.css";
import { LinkedText } from "@/components/landing/linked-text";
import { ProofVideo } from "@/components/problems/proof-video";
import s from "@/components/problems/problems.module.css";
import { PRICE_LINE } from "@/lib/answers";
import {
  HOW_INDEX_PATH,
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

function ProofMeta({ page }: { page: ProblemPage }) {
  const proof = page.proof;
  if (proof.kind === "steps-only") return null;
  const real = proof.kind === "video" && proof.video.realDuration ? formatDuration(proof.video.realDuration) : null;
  const speed =
    proof.kind !== "video"
      ? null
      : proof.video.speed && proof.video.speed > 1
        ? `Sped up ${proof.video.speed}×${real ? ` (the run took ${real})` : ""}`
        : real
          ? `Waits sped up (the run took ${real})`
          : null;
  return (
    <dl className={s.proofMeta}>
      <div>
        <dt>Recorded</dt>
        <dd>{formatDate(proof.recordedOn)}</dd>
      </div>
      <div>
        <dt>Computer</dt>
        <dd>{proof.platform}</dd>
      </div>
      <div>
        <dt>Model</dt>
        <dd>{proof.model}</dd>
      </div>
      {speed ? (
        <div>
          <dt>Playback</dt>
          <dd>{speed}</dd>
        </div>
      ) : null}
    </dl>
  );
}

function StellaDoingIt({ page }: { page: ProblemPage }) {
  const proof = page.proof;
  return (
    <section className={s.block} aria-labelledby="stella-title" id="stella">
      <h2 id="stella-title" className={s.h2}>
        Stella doing it
      </h2>
      {proof.kind === "video" ? (
        <>
          <ProofVideo
            src={proof.video.src}
            poster={proof.video.poster}
            captions={captionsPath(page)!}
            width={proof.video.width}
            height={proof.video.height}
            label={`Screen recording: Stella ${page.h1.charAt(0).toLowerCase()}${page.h1.slice(1)}`}
            moments={proof.moments}
          />
          <ProofMeta page={page} />
          <p className={s.result}>
            <strong>Result.</strong> <LinkedText text={proof.result} />
            {proof.note ? <span className={s.note}> {proof.note}</span> : null}
          </p>
          {proof.output ? (
            <figure className={s.output} data-wide={proof.output.width > proof.output.height ? "" : undefined}>
              <video
                className={s.outputVideo}
                src={proof.output.src}
                poster={proof.output.poster}
                width={proof.output.width}
                height={proof.output.height}
                controls
                playsInline
                preload="none"
                style={{ aspectRatio: `${proof.output.width} / ${proof.output.height}` }}
              />
              <figcaption>
                <span className={s.outputLabel}>The file Stella made</span>
                <LinkedText text={proof.output.caption} />
              </figcaption>
            </figure>
          ) : null}
          {proof.shots?.map((shot) => (
            <figure key={shot.src} className={s.shot} style={{ marginTop: 24 }}>
              {/* eslint-disable-next-line @next/next/no-img-element -- proof media lives on R2, already sized */}
              <img src={shot.src} alt={shot.alt} width={shot.width} height={shot.height} loading="lazy" />
              {shot.caption ? <figcaption>{shot.caption}</figcaption> : null}
            </figure>
          ))}
        </>
      ) : proof.kind === "shots" ? (
        <>
          <div className={s.shots}>
            {proof.shots.map((shot, i) => (
              <figure key={shot.src} className={s.shot}>
                {/* eslint-disable-next-line @next/next/no-img-element -- proof media lives on R2, already sized */}
                <img src={shot.src} alt={shot.alt} width={shot.width} height={shot.height} loading={i ? "lazy" : "eager"} />
                {shot.caption ? <figcaption>{shot.caption}</figcaption> : null}
              </figure>
            ))}
          </div>
          <ProofMeta page={page} />
          <p className={s.result}>
            <strong>Result.</strong> <LinkedText text={proof.result} />
          </p>
        </>
      ) : (
        <p className={s.stepsOnly}>
          <strong>No recording yet.</strong> {proof.reason}
        </p>
      )}
      <h3 className={s.h3}>What Stella does</h3>
      <ol className={s.stellaSteps}>
        {page.stellaSteps.map((step) => (
          <li key={step}>
            <LinkedText text={step} />
          </li>
        ))}
      </ol>
    </section>
  );
}

export default async function ProblemPageRoute({ params }: Params) {
  const { niche: nicheSlug, problem } = await params;
  const page = getProblemPage(nicheSlug, problem);
  const niche = getNiche(nicheSlug);
  if (!page || !niche) notFound();

  const site = getSiteUrl();
  const faq = [...page.faq, ...sharedFaq(page)];
  const near = neighbours(page);
  const proofLine =
    page.proof.kind === "steps-only"
      ? "Steps only: no recording yet"
      : `Shown working on ${page.proof.platform}, ${formatDate(page.proof.recordedOn)}`;

  return (
    <div className={`${l.root} ${landingFontVars}`} data-landing-root="" data-native-scroll="">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(problemJsonLd(page, site)) }} />
      <Backdrop />
      <LandingHeader />
      <main>
        <article className={s.article} data-tone="light" data-bg="#ffffff">
          <header className={s.hero}>
            <nav className={s.crumbs} aria-label="Breadcrumb">
              <Link href={HOW_INDEX_PATH}>How-to</Link>
              <span aria-hidden="true">/</span>
              <Link href={nichePath(niche)}>{niche.name}</Link>
            </nav>
            <h1 className={s.title}>{page.h1}</h1>
            <p className={s.answer}>
              <LinkedText text={page.answer} />
            </p>
            <ul className={s.facts} aria-label="About this guide">
              <li>Checked {formatDate(page.lastChecked)}</li>
              <li>Stella does it on {platformList(page)}</li>
              <li>{proofLine}</li>
            </ul>
            <div className={s.cta}>
              <DownloadButton />
              <span className={s.free}>{PRICE_LINE}</span>
            </div>
          </header>

          <div className={s.body}>
            <div className={s.main}>
              <StellaDoingIt page={page} />

              <section className={s.block} aria-labelledby="prompt-title" id="prompt">
                <h2 id="prompt-title" className={s.h2}>
                  The prompt to paste
                </h2>
                <div className={s.prompt}>
                  <p className={s.promptText}>{page.prompt}</p>
                  <CopyPromptButton text={page.prompt} className={s.copy} />
                </div>
                <p className={s.hint}>Open Stella, paste it into the chat and press Enter. If your files are somewhere unusual, say where.</p>
              </section>

              <section className={s.block} aria-labelledby="diy-title" id="diy">
                <h2 id="diy-title" className={s.h2}>
                  {page.manualTitle ?? "Do it yourself"}
                </h2>
                <ol className={s.manual}>
                  {page.manualSteps.map((step, i) => (
                    <li key={step.title}>
                      <span className={s.stepNo} aria-hidden="true">
                        {i + 1}
                      </span>
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

              <section className={s.block} aria-labelledby="limits-title" id="limits">
                <h2 id="limits-title" className={s.h2}>
                  Where Stella stops
                </h2>
                <ul className={s.limits}>
                  {page.limits.map((limit) => (
                    <li key={limit}>
                      <LinkedText text={limit} />
                    </li>
                  ))}
                </ul>
              </section>

              <section className={s.block} aria-labelledby="faq-title" id="faq">
                <h2 id="faq-title" className={s.h2}>
                  Questions
                </h2>
                <div className={s.faq}>
                  {faq.map((item) => (
                    <div key={item.q} className={s.faqItem}>
                      <h3>{item.q}</h3>
                      <p>
                        <LinkedText text={item.a} />
                      </p>
                    </div>
                  ))}
                </div>
              </section>

              <p className={s.sources}>
                Checked {formatDate(page.lastChecked)}. Sources:{" "}
                {page.sources.map((source, i) => (
                  <span key={source.href}>
                    {i > 0 ? ", " : null}
                    <a href={source.href} target="_blank" rel="noopener noreferrer">
                      {source.label}
                    </a>
                  </span>
                ))}
                . Something out of date? Tell us at stella.sh.
              </p>
            </div>

            <aside className={s.aside} aria-label="On this page">
              <div className={s.asideSticky}>
                <p className={s.asideLabel}>On this page</p>
                <ul className={s.toc}>
                  <li>
                    <a href="#stella">Stella doing it</a>
                  </li>
                  <li>
                    <a href="#prompt">The prompt to paste</a>
                  </li>
                  <li>
                    <a href="#diy">Do it yourself</a>
                  </li>
                  <li>
                    <a href="#limits">Where Stella stops</a>
                  </li>
                  <li>
                    <a href="#faq">Questions</a>
                  </li>
                </ul>
                <div className={s.asideGet}>
                  <p>Let Stella do it on your computer.</p>
                  <DownloadButton />
                  <span className={s.free}>{PRICE_LINE}</span>
                </div>
              </div>
            </aside>
          </div>

          <nav className={s.related} aria-labelledby="related-title">
            <h2 id="related-title" className={s.relatedTitle}>
              Related problems
            </h2>
            <ul className={s.relatedList}>
              {near.map((other) => (
                <li key={problemPath(other)}>
                  <Link href={problemPath(other)}>
                    <span className={s.relatedNiche}>{getNiche(other.niche)?.name}</span>
                    {other.h1}
                  </Link>
                </li>
              ))}
            </ul>
            <p className={s.relatedMore}>
              <Link href={nichePath(niche)}>More {niche.name} guides</Link>
              <Link href={HOW_INDEX_PATH}>Every how-to</Link>
            </p>
          </nav>
        </article>

        <Finale title="Let Stella do the fiddly part." note={PRICE_LINE} />
      </main>
      <LandingFooter />
    </div>
  );
}
