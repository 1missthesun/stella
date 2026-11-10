import Link from "next/link";
import { CopyPromptButton } from "@/components/copy-prompt-button";
import { DownloadButton } from "@/components/download-button";
import o from "@/components/landing/opening.module.css";
import { FREE_LINE, guideLabel, problemPath, type ProblemPage } from "@/lib/problems";
import h from "./how.module.css";

/** A title in the home page's style: the part after a question mark goes wide. */
export function HowTitle({ text, id }: { text: string; id?: string }) {
  const cut = text.indexOf("? ");
  const long = text.length > 46 ? "" : undefined;
  if (cut < 0) {
    return (
      <h1 id={id} className={h.title} data-long={long}>
        {text}
      </h1>
    );
  }
  return (
    <h1 id={id} className={h.title} data-long={long}>
      {text.slice(0, cut + 1)} <span className={h.wide}>{text.slice(cut + 2)}</span>
    </h1>
  );
}

/** The download button and price line exactly as the home hero shows them. */
export function HeroCta() {
  return (
    <div className={`${o.cta} ${h.heroCta}`}>
      <DownloadButton />
      <span className={o.free}>{FREE_LINE}</span>
    </div>
  );
}

export function BackLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <Link href={href} className={h.back}>
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M15 5l-7 7 7 7" />
      </svg>
      {children}
    </Link>
  );
}

/** The exact prompt, shown like Stella's own composer, with a copy button. */
export function PromptCard({ text }: { text: string }) {
  return (
    <div className={h.prompt}>
      <p className={h.promptText}>{text}</p>
      <div className={h.promptBar}>
        <span className={h.promptHint}>Paste it into Stella and press Enter.</span>
        <CopyPromptButton text={text} className={h.copy} />
      </div>
    </div>
  );
}

function Thumb({ page }: { page: ProblemPage }) {
  const proof = page.proof;
  if (proof.kind === "video") {
    const still = proof.video.cuts?.thumb;
    return (
      <div className={h.thumb}>
        {still ? (
          // eslint-disable-next-line @next/next/no-img-element -- proof media lives on R2, already sized
          <img src={still.src} alt="" loading="lazy" width={still.width} height={still.height} data-cut="" />
        ) : (
          // eslint-disable-next-line @next/next/no-img-element -- proof media lives on R2, already sized
          <img src={proof.video.poster} alt="" loading="lazy" width={proof.video.width} height={proof.video.height} />
        )}
        <span className={h.thumbPlay} aria-hidden="true">
          <svg viewBox="0 0 24 24">
            <path d="M7 4.6v14.8c0 .8.9 1.3 1.6.9l11.6-7.4c.6-.4.6-1.3 0-1.7L8.6 3.8C7.9 3.3 7 3.8 7 4.6z" />
          </svg>
        </span>
      </div>
    );
  }
  if (proof.kind === "shots") {
    const shot = proof.shots[0];
    return (
      <div className={h.thumb}>
        {/* eslint-disable-next-line @next/next/no-img-element -- proof media lives on R2, already sized */}
        <img src={shot.src} alt="" loading="lazy" width={shot.width} height={shot.height} />
      </div>
    );
  }
  return (
    <div className={`${h.thumb} ${h.thumbWall}`}>
      <div className={h.thumbPrompt}>
        <p>
          <span>{page.prompt}</span>
        </p>
      </div>
    </div>
  );
}

export function GuideCard({ page, level = 3 }: { page: ProblemPage; level?: 2 | 3 }) {
  const Title = level === 2 ? "h2" : "h3";
  return (
    <Link href={problemPath(page)} className={h.card}>
      <Thumb page={page} />
      <Title className={h.cardTitle}>{page.h1}</Title>
      <p className={h.cardLede}>{page.lede}</p>
      <span className={h.cardMeta}>{guideLabel(page)}</span>
    </Link>
  );
}

export function GuideGrid({ pages }: { pages: ProblemPage[] }) {
  return (
    <ul className={h.cards}>
      {pages.map((page) => (
        <li key={problemPath(page)}>
          <GuideCard page={page} />
        </li>
      ))}
    </ul>
  );
}
