import type { Metadata } from "next";
import Link from "next/link";
import {
  ArrowRight,
  AudioLines,
  Blocks,
  CalendarClock,
  Cpu,
  FolderOpen,
  Globe,
  Mic,
  Monitor,
  MousePointer2,
  PanelTopOpen,
  Smartphone,
  Sparkles,
  Zap,
} from "lucide-react";
import { DownloadButton } from "@/components/download-button";
import { WindowsInstallNote } from "@/components/windows-install-note";
import { Her, Me, MockChat, MockStage, Stamp, Task } from "@/components/landing/chat-mock";
import { Finale } from "@/components/landing/closing";
import { InView } from "@/components/landing/in-view";
import { PageShell } from "@/components/landing/page-shell";
import pg from "@/components/landing/page.module.css";
import { changelogEntries } from "./changelog-entries";
import lm from "./learn-more.module.css";

export const metadata: Metadata = {
  title: "Learn More",
  description:
    "Learn what Stella can do, how to use it, and what changed recently.",
  alternates: { canonical: "/learn-more" },
};

const capabilities = [
  {
    icon: MousePointer2,
    title: "Use your computer",
    body: "Inspect the screen, click, type, open apps, navigate windows, and work with what is actually in front of you.",
  },
  {
    icon: Globe,
    title: "Use the web",
    body: "Browse, search, read pages, fill forms, and use browser context when it helps.",
  },
  {
    icon: FolderOpen,
    title: "Work with files",
    body: "Read, write, organize, summarize, and transform documents, spreadsheets, PDFs, presentations, images, and generated outputs.",
  },
  {
    icon: Sparkles,
    title: "Create media",
    body: "Help make images, video, audio, 3D assets, small apps, games, mockups, and visual artifacts. Image, video, 3D, and voice generation come with the Pro plan.",
  },
  {
    icon: Mic,
    title: "Listen and speak",
    body: "Use in-app dictation, OS-wide dictation, read-aloud, and realtime voice. Wake-word activation is optional. Dictation and wake word are on every tier; read-aloud and realtime voice come with the Pro plan.",
  },
  {
    icon: CalendarClock,
    title: "Run routines",
    body: "Create reminders, recurring check-ins, scheduled work, and automations from plain English.",
  },
  {
    icon: Blocks,
    title: "Connect apps",
    body: "Use supported services, including the Stella mobile app, Google Workspace, and Store-backed integrations.",
  },
  {
    icon: Cpu,
    title: "Choose your model",
    body: "Use Stella's managed provider, bring your own keys, use local models, pick OpenRouter-style options where supported, or select Claude Code as the engine.",
  },
];

const accessMethods = [
  {
    icon: Globe,
    title: "Browser",
    body: "Open Stella in your browser to chat, start tasks, and work with files. No installation needed.",
  },
  {
    icon: Monitor,
    title: "Desktop app",
    body: "Use Stella on macOS, Windows, or Linux, with access to your computer and desktop apps.",
  },
  {
    icon: Smartphone,
    title: "Mobile app",
    body: "Chat and manage tasks from your phone. Connect the desktop app when you want Stella to work on that computer.",
  },
  {
    icon: Zap,
    title: "Quick access on desktop",
    body: "Capture, chat, add context, or start voice from the app or page you are already using.",
  },
  {
    icon: PanelTopOpen,
    title: "Mini window on desktop",
    body: "Keep a smaller Stella window nearby for quick asks without taking over your screen.",
  },
  {
    icon: AudioLines,
    title: "Voice and dictation",
    body: "Dictate into Stella or talk in realtime. The desktop app also supports dictation into other apps.",
  },
];


const sections = [
  { label: "What Stella is", href: "#what-stella-is" },
  { label: "One chat", href: "#one-chat" },
  { label: "Capabilities", href: "#capabilities" },
  { label: "Access", href: "#access" },
  { label: "Privacy", href: "#privacy" },
  { label: "Models", href: "#models" },
  { label: "What's new", href: "/learn-more/whats-new" },
  { label: "What Stella can fix", href: "/fix" },
];

const MODEL_LOGOS = [
  { name: "Claude Code", logo: "claude-code", tile: "claude" },
  { name: "ChatGPT", logo: "chatgpt" },
  { name: "Gemini", logo: "gemini" },
  { name: "DeepSeek", logo: "deepseek" },
  { name: "Qwen", logo: "qwen" },
  { name: "Mistral", logo: "mistral" },
  { name: "Llama", logo: "meta" },
  { name: "OpenRouter", logo: "openrouter" },
];

const DARK = { id: "default", dark: true };

export default function LearnMore() {
  const recent = changelogEntries.filter((entry) => entry.release).slice(0, 3);

  return (
    <PageShell
      closing={
        <Finale
          title="Your assistant, wherever you need it."
          body="Use Stella in your browser, desktop app, or mobile app."
          actions={<Link href="/chat">Open Stella</Link>}
          note="Free. No credit card, no trial."
        />
      }
    >
      <section id="overview" className={pg.hero} data-tone="light" data-bg="#ffffff">
        <p className={pg.eyebrow}>Learn more</p>
        <h1 className={pg.title}>
          Stella, <em>in detail.</em>
        </h1>
        <p className={pg.lede}>
          Your personal AI assistant, available in your browser, desktop app, and mobile app. Ask once, keep
          talking, and Stella figures out which agent, app, file, browser, model, or tool should handle the work.
        </p>
        <p className={pg.lede}>
          Background agents can handle independent work and report progress inline without making you manage
          separate threads.
        </p>
        <div className={pg.cta}>
          <DownloadButton />
          <Link className={pg.secondary} href="/chat">
            Open Stella
          </Link>
        </div>
        <div className={pg.note}>
          <WindowsInstallNote />
        </div>
        <p className={pg.reassure}>Free. No credit card, no trial.</p>
        <nav className={lm.index} aria-label="Learn More sections">
          {sections.map((item) =>
            item.href.startsWith("#") ? (
              <a key={item.href} href={item.href}>
                {item.label}
              </a>
            ) : (
              <Link key={item.href} href={item.href}>
                {item.label}
              </Link>
            ),
          )}
        </nav>
      </section>

      <section id="what-stella-is" className={pg.split} data-tone="light" data-bg="#ffffff">
        <div className={pg.copy}>
          <p className={pg.eyebrow}>What Stella is</p>
          <h2 className={pg.h2}>One assistant, wherever you are</h2>
          <p>Stella works with your files, apps, and browser to help you get things done.</p>
          <p>
            You can use Stella for research, writing, spreadsheets, PDFs, Word documents, browser tasks, computer
            control, image generation, video and 3D workflows, media prompts, scheduling, reminders, dictation,
            realtime voice, and connected apps.
          </p>
          <p>
            Keep your work in one conversation, whether you use Stella in your browser, on your desktop, or on your
            phone.
          </p>
        </div>
        <MockStage>
          <MockChat>
            <Stamp d={0}>Today 9:12 AM</Stamp>
            <Me d={150}>Clean up my Downloads folder?</Me>
            <Her d={550}>Done. 214 files sorted into 9 folders, and 3.2 GB of old installers moved to the Bin.</Her>
            <Stamp d={1000}>Today 7:42 PM</Stamp>
            <Me d={1150}>Find us a table for four on Friday around 8</Me>
            <Her d={1600}>Booked Lucia for 8pm Friday. It&apos;s in your calendar, and I let Sam and Priya know.</Her>
          </MockChat>
        </MockStage>
      </section>

      <section id="one-chat" className={`${pg.split} ${pg.flip}`} data-tone="light" data-bg="#f1f1f4">
        <div className={pg.copy}>
          <p className={pg.eyebrow}>One chat</p>
          <h2 className={pg.h2}>You keep talking in the same place</h2>
          <p>
            Most agent products make you choose a mode, start a new thread, pick a specialist, then remember where
            everything went. Stella keeps the top-level experience continuous.
          </p>
          <p>
            Behind the scenes, Stella can split work into smaller jobs, run specialized agents, keep track of active
            threads, and bring the result back into the conversation. Orchestrator mode is the default, so you stay
            in one conversation instead of becoming the project manager for your assistant.
          </p>
        </div>
        <MockStage dark>
          <MockChat theme={DARK} status="In progress">
            <Me d={0}>Plan Mum&apos;s birthday and turn my notes into a deck</Me>
            <Task label="Planning the birthday" d={350} doneAt={1700} />
            <Task label="Building the deck" d={550} />
            <Her d={2300}>Booked Nopa for 8 on the 14th. The deck is still going.</Her>
          </MockChat>
        </MockStage>
      </section>

      <section id="capabilities" className={lm.block} data-tone="light" data-bg="#ffffff">
        <div className={lm.blockHead}>
          <p className={pg.eyebrow}>Capabilities</p>
          <h2 className={pg.h2}>What Stella can do</h2>
        </div>
        <InView className={lm.caps} threshold={0.1}>
          {capabilities.map(({ icon: Icon, title, body }, i) => (
            <article key={title} className={lm.cap} style={{ ["--i" as string]: i }}>
              <span className={lm.capIcon}>
                <Icon size={22} strokeWidth={1.8} aria-hidden="true" />
              </span>
              <h3>{title}</h3>
              <p>{body}</p>
            </article>
          ))}
        </InView>
      </section>

      <section id="access" className={lm.block} data-tone="light" data-bg="#f1f1f4">
        <div className={lm.blockHead}>
          <p className={pg.eyebrow}>Access</p>
          <h2 className={pg.h2}>Ways to reach Stella</h2>
        </div>
        <InView className={lm.access} threshold={0.1}>
          {accessMethods.map(({ icon: Icon, title, body }, i) => (
            <article key={title} className={lm.way} style={{ ["--i" as string]: i }}>
              <Icon size={24} strokeWidth={1.7} aria-hidden="true" />
              <h3>{title}</h3>
              <p>{body}</p>
            </article>
          ))}
        </InView>
      </section>

      <section id="privacy" className={lm.privacy} data-tone="light" data-bg="#ffffff">
        <p className={pg.eyebrow}>Privacy</p>
        <h2 className={pg.h2}>Your privacy</h2>
        <p>
          Read our <Link href="/privacy">Privacy Policy</Link> for details on how Stella handles your information
          and the choices available to you.
        </p>
      </section>

      <section id="models" className={`${pg.split} ${pg.panel}`} data-tone="dark" data-bg="#ffffff">
        <div className={`${pg.copy} ${lm.onDark}`}>
          <p className={pg.eyebrow}>Models</p>
          <h2 className={pg.h2}>Use Stella, BYOK, local models, or Claude Code</h2>
          <p>
            Stella has a managed path for convenience and a provider-control path for people who want to bring their
            own providers.
          </p>
          <p>
            Stella Provider lets you start using strong models without setting up accounts everywhere. Requests pass
            through Stella&apos;s infrastructure so billing and limits can work. Responses may be buffered briefly
            for stream recovery, and providers may retain submitted data under their policies.
          </p>
          <p>
            You can also add your own provider credentials, use local runtimes, and use Claude Code directly as the
            assistant engine. Provider and engine options depend on the client you use.
          </p>
        </div>
        <InView className={lm.models} ariaHidden>
          {MODEL_LOGOS.map((m, i) => (
            <span key={m.name} className={lm.model} data-tile={m.tile} style={{ ["--i" as string]: i }}>
              <span
                className={lm.modelLogo}
                style={{ ["--logo" as string]: `url(/landing/logos/${m.logo}.svg)` }}
                data-color={m.tile ? "1" : "0"}
              />
              <b>{m.name}</b>
            </span>
          ))}
        </InView>
      </section>

      <section id="whats-new-link" className={lm.block} data-tone="light" data-bg="#ffffff">
        <div className={lm.newsHead}>
          <div>
            <p className={pg.eyebrow}>What&apos;s new</p>
            <h2 className={pg.h2}>A running changelog</h2>
            <p className={lm.newsLede}>
              Stella ships preview updates almost daily. The full log, grouped by date with new features and fixes,
              lives on its own page so you can scroll the history without leaving Learn More.
            </p>
          </div>
          <Link className={pg.secondary} href="/learn-more/whats-new">
            Read the changelog
            <ArrowRight size={16} />
          </Link>
        </div>
        <div className={lm.news}>
          {recent.map((entry) => (
            <Link key={`${entry.release}-${entry.date}`} href="/learn-more/whats-new" className={lm.newsCard}>
              <span className={lm.newsMeta}>
                <b>{entry.release}</b>
                <span>{entry.date}</span>
              </span>
              <ul>
                {(entry.highlights ?? []).slice(0, 2).map((item, i) => (
                  <li key={i}>{typeof item === "string" ? item : item.text}</li>
                ))}
              </ul>
            </Link>
          ))}
        </div>
      </section>
    </PageShell>
  );
}
