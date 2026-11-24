import Link from "next/link";
import { CopyPromptButton } from "@/components/copy-prompt-button";
import { DownloadButton } from "@/components/download-button";
import o from "@/components/landing/opening.module.css";
import { DemoStill } from "@/components/stella-demo/demo-view";
import { FREE_LINE, GUIDE_LABEL, pageDemo, problemPath, type ProblemPage } from "@/lib/problems";
import h from "./how.module.css";

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
  return (
    <div className={h.thumb}>
      <DemoStill steps={pageDemo(page)} />
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
      <span className={h.cardMeta}>{GUIDE_LABEL}</span>
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
