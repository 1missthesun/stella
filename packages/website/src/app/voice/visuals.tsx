"use client";

import type { ReactNode } from "react";
import { AudioLines, Check, Laptop, Monitor, X } from "lucide-react";
import { Her, Me, MockChat, MockStage } from "@/components/landing/chat-mock";
import { StellaCharacter } from "@/components/landing/stella-character";
import v from "./visuals.module.css";

const SEED = [22, 38, 60, 46, 74, 92, 70, 54, 84, 100, 76, 58, 40, 66, 88, 96, 72, 50, 34, 62, 90, 78, 56, 44, 68, 86, 98, 74, 52, 36];
const BARS = Array.from({ length: 64 }, (_, i) => SEED[(i * 7 + (i % 5)) % SEED.length]);

function Wave() {
  return (
    <span className={v.wave}>
      {BARS.map((h, i) => (
        <i key={i} style={{ height: `${h}%`, ["--i" as string]: i % 24 }} />
      ))}
    </span>
  );
}

function DictationBar({ time }: { time: string }) {
  return (
    <div className={v.dictation}>
      <Wave />
      <span className={v.timer}>{time}</span>
      <span className={v.ctl}>
        <X size={14} />
      </span>
      <span className={v.ctl} data-strong="1">
        <Check size={15} />
      </span>
    </div>
  );
}

export function DictationVisual() {
  return (
    <MockStage>
      <MockChat composer={<DictationBar time="0:07" />}>
        <Me d={0}>Write Priya a note that the Thursday review moved to Friday at 10.</Me>
        <Her d={500}>Drafted it — subject &ldquo;Review moved to Friday 10:00&rdquo;. Want me to send it?</Her>
      </MockChat>
    </MockStage>
  );
}

export function AnywhereVisual() {
  return (
    <MockStage dark>
      <div className={v.mail}>
        <div className={v.mailBar}>
          <span className={v.lights}>
            <i />
            <i />
            <i />
          </span>
          New Message
        </div>
        <dl className={v.fields}>
          <div>
            <dt>To:</dt>
            <dd>priya@northwind.co</dd>
          </div>
          <div>
            <dt>Cc:</dt>
            <dd>design@northwind.co</dd>
          </div>
          <div>
            <dt>Subject:</dt>
            <dd>Review moved to Friday 10:00</dd>
          </div>
        </dl>
        <p className={v.mailText}>
          <span className={v.words}>
            Hi Priya — quick heads up that Thursday&apos;s review has moved to Friday at 10. Same room, same agenda,
            and the deck is already in the shared folder if you want a look beforehand. I&apos;ll bring the updated
            numbers and the one-pager
          </span>
          <span className={v.caret} />
        </p>
      </div>
      <div className={v.pill}>
        <Wave />
        <span className={v.timer}>0:12</span>
      </div>
    </MockStage>
  );
}

function SettingsCard({
  device,
  icon,
  rows,
  d,
}: {
  device: string;
  icon: ReactNode;
  rows: { title: string; sub: string; on: boolean; flip?: boolean }[];
  d: number;
}) {
  return (
    <div className={v.settings} style={{ ["--d" as string]: `${d}ms` }}>
      <div className={v.settingsHead}>
        {icon}
        <span>Settings — Audio</span>
        <b>{device}</b>
      </div>
      <ul>
        {rows.map((row) => (
          <li key={row.title}>
            <span>
              <b>{row.title}</b>
              <small>{row.sub}</small>
            </span>
            <i className={v.toggle} data-on={row.on ? "1" : "0"} data-flip={row.flip ? "1" : "0"} />
          </li>
        ))}
      </ul>
    </div>
  );
}

export function EveryComputerVisual() {
  return (
    <MockStage className={v.column}>
      <SettingsCard
        device="Mac"
        icon={<Laptop size={15} />}
        d={0}
        rows={[
          { title: "Super Fast dictation", sub: "Keep the microphone warm so dictation starts with less delay.", on: true },
          { title: "Dictation sounds", sub: "Play a sound when dictation starts and stops.", on: true },
        ]}
      />
      <SettingsCard
        device="Windows"
        icon={<Monitor size={15} />}
        d={220}
        rows={[
          { title: "Enable microphone", sub: "Required for talking to Stella.", on: true },
          { title: "Super Fast dictation", sub: "Keep the microphone warm so dictation starts with less delay.", on: true },
        ]}
      />
    </MockStage>
  );
}

export function WakeWordVisual() {
  return (
    <MockStage dark className={v.column}>
      <SettingsCard
        device="Microphone"
        icon={<AudioLines size={15} />}
        d={0}
        rows={[
          { title: "Enable microphone", sub: "Required for talking to Stella.", on: true },
          {
            title: "Hey Stella wake word",
            sub: "Listen for “Hey Stella” in the background and start a voice conversation. When off, mic stays idle until you press dictate.",
            on: false,
            flip: true,
          },
        ]}
      />
      <div className={v.wake}>
        <span className={v.sprite}>
          <span className={v.ring} />
          <span className={v.ring} />
          <StellaCharacter size={30} state="working" eyeColor="#14141c" />
        </span>
        <span className={v.wakeText}>
          <b>&ldquo;Hey Stella&rdquo;</b>
          <span>Hi. What should we get done?</span>
        </span>
      </div>
    </MockStage>
  );
}

export function LiveVisual() {
  return (
    <MockStage>
      <MockChat
        composer={
          <div className={v.liveComposer}>
            <span>Message Stella</span>
            <i>
              <AudioLines size={15} />
            </i>
          </div>
        }
      >
        <Me d={0}>Hey Stella</Me>
        <div className={v.session} style={{ ["--d" as string]: "450ms" }}>
          <AudioLines size={14} strokeWidth={1.75} />
          <span>Talked with Stella</span>
          <em>4m 12s</em>
        </div>
        <Her d={1000}>
          Booked the 8:05 flight, moved the review to Friday, and put the summary in your inbox. Say &ldquo;bye&rdquo;
          whenever you&apos;re done.
        </Her>
      </MockChat>
    </MockStage>
  );
}
