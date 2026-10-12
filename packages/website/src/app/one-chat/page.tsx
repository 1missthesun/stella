import type { Metadata } from "next";
import Link from "next/link";
import { Bell, CalendarClock, Cpu, FileText, KeyRound } from "lucide-react";
import { WindowsInstallNote } from "@/components/windows-install-note";
import { Card, Her, Me, MockChat, MockStage, Stamp, Task } from "@/components/landing/chat-mock";
import { Finale } from "@/components/landing/closing";
import { PageShell } from "@/components/landing/page-shell";
import pg from "@/components/landing/page.module.css";
import { StellaMark } from "@/components/stella-mark";
import styles from "./one-chat.module.css";

export const metadata: Metadata = {
  title: "One chat",
  description:
    "Stella is one ongoing conversation. Questions, tasks, follow-ups, results, and scheduled things all live in one place. Work runs in the background without freezing your chat, and nothing gets lost between threads — because there are no threads.",
  alternates: { canonical: "/one-chat" },
};

const DARK = { id: "default", dark: true };

export default function OneChatPage() {
  return (
    <PageShell
      closing={
        <Finale
          title="Ask once. Keep talking."
          body={
            <>
              One ongoing chat, with the work happening behind it — on Stella&apos;s models or yours. Running
              several jobs at once in the background comes with <Link href="/pricing">Pro</Link>; other plans
              work through one at a time.
            </>
          }
          note="Free. No credit card, no trial."
          after={<WindowsInstallNote />}
        />
      }
    >
      <section className={`${pg.hero} ${pg.center}`} data-tone="light" data-bg="#ffffff">
        <p className={pg.eyebrow}>One chat</p>
        <h1 className={pg.title}>
          One chat. <em>Everything in it.</em>
        </h1>
        <p className={pg.lede}>
          Other chat apps spread your life across a dozen threads. Stella is one ongoing conversation — ask,
          follow up, get results, come back tomorrow. It&apos;s all right here.
        </p>
      </section>

      <section className={pg.split} data-tone="light" data-bg="#ffffff" aria-labelledby="one-place">
        <div className={pg.copy}>
          <p className={pg.eyebrow}>One place</p>
          <h2 id="one-place" className={pg.h2}>
            Everything you ask lives in one place.
          </h2>
          <p>
            Most chatbots want a fresh thread for every question, so your history ends up scattered and the
            context goes with it. In Stella there&apos;s just one conversation. The trip you planned last week,
            the email from this morning, the thing you&apos;re about to ask — same place, same Stella.
          </p>
        </div>
        <MockStage>
          <MockChat>
            <Stamp d={0}>Last week</Stamp>
            <Me d={150}>plan my trip</Me>
            <Her d={500}>Lisbon, 12 to 16 May. Flights and hotel are in your calendar.</Her>
            <Stamp d={900}>This morning</Stamp>
            <Me d={1050}>draft the emails</Me>
            <Her d={1400}>Three drafts are waiting in Gmail.</Her>
            <Stamp d={1800}>Now</Stamp>
            <Me d={1950}>actually, make it Thursday</Me>
            <Her d={2400}>Moved to Thursday. The drafts say Thursday too.</Her>
          </MockChat>
        </MockStage>
      </section>

      <section className={`${pg.split} ${pg.flip}`} data-tone="light" data-bg="#f1f1f4" aria-labelledby="no-waiting">
        <div className={pg.copy}>
          <p className={pg.eyebrow}>No waiting</p>
          <h2 id="no-waiting" className={pg.h2}>
            Work runs in the background. Your chat stays open.
          </h2>
          <p>
            Ask for something big and Stella gets going on it without freezing the conversation. Keep typing,
            ask something else, step away — she brings the result back into the same chat the moment it&apos;s
            ready.
          </p>
        </div>
        <MockStage dark>
          <MockChat theme={DARK} status="In progress" typed="…and you keep typing" typedAt={1400}>
            <Me d={0}>Find flights, draft the emails and book a table</Me>
            <Task label="research flights" d={350} />
            <Task label="draft emails" d={550} />
            <Task label="book a table" d={750} doneAt={1900} />
            <Her d={2900}>Booked a table for four at 8.</Her>
          </MockChat>
        </MockStage>
      </section>

      <section className={pg.split} data-tone="light" data-bg="#ffffff" aria-labelledby="nothing-lost">
        <div className={pg.copy}>
          <p className={pg.eyebrow}>Nothing lost</p>
          <h2 id="nothing-lost" className={pg.h2}>
            No threads. So nothing falls between them.
          </h2>
          <p>
            There&apos;s no hunting for the chat where you asked that thing. Follow-ups, results, reminders, and
            scheduled work all land in the one conversation you already have — with the context still intact.
          </p>
        </div>
        <MockStage>
          <MockChat>
            <Me d={0}>What did the landlord say about the deposit?</Me>
            <Her d={350}>He&apos;ll return it in full by Friday.</Her>
            <Card d={800} icon={<FileText size={15} />} title="Deposit receipt.pdf" meta="Result" />
            <Card d={1150} icon={<Bell size={15} />} title="Check the deposit arrived" meta="Reminder · Friday 9:00" />
            <Card d={1500} icon={<CalendarClock size={15} />} title="Weekly money check-in" meta="Scheduled · Mondays" />
          </MockChat>
        </MockStage>
      </section>

      <section className={`${pg.split} ${pg.flip} ${pg.panel}`} data-tone="dark" data-bg="#ffffff" aria-labelledby="any-brain">
        <div className={`${pg.copy} ${styles.onDark}`}>
          <p className={pg.eyebrow}>Any brain you like</p>
          <h2 id="any-brain" className={pg.h2}>
            Nothing to set up — or bring your own.
          </h2>
          <p>
            Out of the box, Stella runs on her own models. No keys, no accounts, no setup — just open the app and
            go. Prefer something else? Plug in Claude Code, Codex, your own key or a local model and Stella runs on
            that instead.
          </p>
        </div>
        <MockStage dark className={styles.engineStage}>
          <div className={styles.engines}>
            <span className={`${styles.engine} ${styles.lead}`} style={{ ["--d" as string]: "0ms" }}>
              <span className={styles.engineMark}>
                <StellaMark size={44} />
              </span>
              <b>Stella</b>
              <em>zero setup</em>
            </span>
            <span className={styles.engine} style={{ ["--d" as string]: "120ms" }}>
              <span className={styles.engineMark} data-tile="claude">
                <img src="/landing/logos/claude-code.svg" alt="" width={40} height={40} />
              </span>
              <b>Claude</b>
            </span>
            <span className={styles.engine} style={{ ["--d" as string]: "200ms" }}>
              <span className={styles.engineMark} data-tile="chatgpt">
                <img src="/landing/logos/chatgpt.svg" alt="" width={40} height={40} />
              </span>
              <b>Codex</b>
            </span>
            <span className={styles.engine} style={{ ["--d" as string]: "280ms" }}>
              <span className={styles.engineMark}>
                <Cpu size={26} />
              </span>
              <b>Local model</b>
            </span>
            <span className={styles.engine} style={{ ["--d" as string]: "360ms" }}>
              <span className={styles.engineMark}>
                <KeyRound size={26} />
              </span>
              <b>Your own key</b>
            </span>
          </div>
        </MockStage>
      </section>

      <section className={pg.split} data-tone="light" data-bg="#ffffff" aria-labelledby="built-in">
        <div className={pg.copy}>
          <p className={pg.eyebrow}>Built in</p>
          <h2 id="built-in" className={pg.h2}>
            Pictures, voice, and more — on Pro.
          </h2>
          <p>
            Ask Stella to make an image, a video, a song, or a spoken reading, and she just does it. It runs on the
            house models with nothing extra to wire up, and it comes with the <Link href="/pricing">Pro plan</Link>.
          </p>
        </div>
        <MockStage className={styles.mediaStage}>
          <div className={styles.media}>
            <figure className={styles.tile} data-kind="image" style={{ ["--d" as string]: "0ms" }}>
              <img src="/landing/cabin.webp" alt="" loading="lazy" decoding="async" />
              <figcaption>Images</figcaption>
            </figure>
            <figure className={styles.tile} data-kind="video" style={{ ["--d" as string]: "120ms" }}>
              <img src="/landing/cabin-poster.webp" alt="" loading="lazy" decoding="async" />
              <span className={styles.play} />
              <figcaption>Video</figcaption>
            </figure>
            <figure className={styles.tile} data-kind="music" style={{ ["--d" as string]: "240ms" }}>
              <img src="/landing/record.webp" alt="" loading="lazy" decoding="async" />
              <figcaption>Music</figcaption>
            </figure>
            <figure className={styles.tile} data-kind="sound" style={{ ["--d" as string]: "360ms" }}>
              <span className={styles.bars}>
                {[38, 72, 54, 90, 62, 100, 46, 80, 58, 34, 68, 50].map((h, i) => (
                  <i key={i} style={{ height: `${h}%`, ["--i" as string]: i }} />
                ))}
              </span>
              <figcaption>Sound</figcaption>
            </figure>
            <figure className={styles.tile} data-kind="3d" style={{ ["--d" as string]: "480ms" }}>
              <img src="/landing/cat-poster.webp" alt="" loading="lazy" decoding="async" />
              <figcaption>3D</figcaption>
            </figure>
            <figure className={styles.tile} data-kind="voice" style={{ ["--d" as string]: "600ms" }}>
              <span className={styles.orb} />
              <figcaption>Live voice</figcaption>
            </figure>
          </div>
        </MockStage>
      </section>
    </PageShell>
  );
}
