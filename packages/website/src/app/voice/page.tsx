import type { Metadata } from "next";
import Link from "next/link";
import { WindowsInstallNote } from "@/components/windows-install-note";
import { Finale } from "@/components/landing/closing";
import { PageShell } from "@/components/landing/page-shell";
import pg from "@/components/landing/page.module.css";
import { AnywhereVisual, DictationVisual, EveryComputerVisual, LiveVisual, WakeWordVisual } from "./visuals";
import styles from "./voice.module.css";

export const metadata: Metadata = {
  title: "Voice",
  description:
    "Talk to Stella out loud with fast cloud dictation and optional wake-word detection.",
  alternates: { canonical: "/voice" },
};

export default function VoicePage() {
  return (
    <PageShell
      closing={
        <Finale
          title="Type less. Say more."
          body="Whether it's a quick note or a full conversation, Stella's ready the second you start talking — hands-free, on every computer."
          note="Free. No credit card, no trial."
          after={<WindowsInstallNote />}
        />
      }
    >
      <section className={`${pg.hero} ${pg.center}`} data-tone="light" data-bg="#ffffff">
        <p className={pg.eyebrow}>Voice</p>
        <h1 className={pg.title}>
          Talk to Stella <em>out loud.</em>
        </h1>
        <p className={pg.lede}>
          Speak instead of type, or just say &quot;Hey Stella.&quot; Your words turn into text the moment you stop
          talking — hands-free, wherever you are.
        </p>
      </section>

      <section className={pg.split} data-tone="light" data-bg="#ffffff" aria-labelledby="dictation">
        <div className={pg.copy}>
          <p className={pg.eyebrow}>Cloud dictation</p>
          <h2 id="dictation" className={pg.h2}>
            Your voice becomes text instantly.
          </h2>
          <p>
            Press the key and talk. Stella streams your speech to its cloud dictation service, so your words show up
            the moment you finish.
          </p>
        </div>
        <DictationVisual />
      </section>

      <section className={`${pg.split} ${pg.flip}`} data-tone="light" data-bg="#f1f1f4" aria-labelledby="anywhere">
        <div className={pg.copy}>
          <p className={pg.eyebrow}>Anywhere</p>
          <h2 id="anywhere" className={pg.h2}>
            Talk to type in any app.
          </h2>
          <p>
            Dictation isn&apos;t just for Stella. Use it in any app on your computer and the words drop straight
            into whatever you&apos;re typing — email, notes, chat, anywhere.
          </p>
        </div>
        <AnywhereVisual />
      </section>

      <section className={pg.split} data-tone="light" data-bg="#ffffff" aria-labelledby="every-computer">
        <div className={pg.copy}>
          <p className={pg.eyebrow}>Every computer</p>
          <h2 id="every-computer" className={pg.h2}>
            It works on every computer.
          </h2>
          <p>
            Stella uses the same cloud dictation service on every supported computer, so dictation behaves the same
            on Windows and Mac.
          </p>
        </div>
        <EveryComputerVisual />
      </section>

      <section className={`${pg.split} ${pg.flip}`} data-tone="light" data-bg="#f1f1f4" aria-labelledby="wake-word">
        <div className={pg.copy}>
          <p className={pg.eyebrow}>Wake word</p>
          <h2 id="wake-word" className={pg.h2}>
            Just say &quot;Hey Stella.&quot;
          </h2>
          <p>
            Flip on the wake word and start talking with no clicking and no keyboard. It listens for &quot;Hey
            Stella&quot; right on your computer, stays off until you turn it on, and steps back the moment you say
            &quot;bye.&quot;
          </p>
        </div>
        <WakeWordVisual />
      </section>

      <section className={pg.split} data-tone="light" data-bg="#ffffff" aria-labelledby="live">
        <div className={pg.copy}>
          <p className={pg.eyebrow}>Live conversation</p>
          <h2 id="live" className={pg.h2}>
            Have a real conversation.
          </h2>
          <p>
            Talk back and forth like a phone call. Stella hears you in real time, answers out loud, and can even take
            a look at your screen when you ask her to.
          </p>
          <p className={styles.planNote}>
            Live conversation and having Stella read her replies aloud come with the{" "}
            <Link href="/pricing">Pro plan</Link>. Dictation and &quot;Hey Stella&quot; are on every tier.
          </p>
        </div>
        <LiveVisual />
      </section>
    </PageShell>
  );
}
