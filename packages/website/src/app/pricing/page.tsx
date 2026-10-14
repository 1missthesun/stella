import type { Metadata } from "next";
import { Check, FolderOpen, KeyRound, Mic, MonitorSmartphone, Paintbrush, Sparkles, type LucideIcon } from "lucide-react";
import { Finale } from "@/components/landing/closing";
import { InView } from "@/components/landing/in-view";
import { PageShell } from "@/components/landing/page-shell";
import pg from "@/components/landing/page.module.css";
import pr from "./pricing.module.css";
import { INCLUDED_IN_EVERY_PLAN, PLAN_ORDER, PLANS } from "@/lib/plans";

export const metadata: Metadata = {
  title: "Pricing",
  description:
    "Choose a Stella plan: Free, Go with 10x higher usage, or Pro with the highest usage limits, media generation, and multiple agents.",
  alternates: { canonical: "/pricing" },
};

const INCLUDED_ICONS: Record<(typeof INCLUDED_IN_EVERY_PLAN)[number], LucideIcon> = {
  "Browser, desktop, and mobile access": MonitorSmartphone,
  "Coding, assistant and research in one app": Sparkles,
  "Dictation and wake word on every tier": Mic,
  "Customizable interface": Paintbrush,
  "Work with files and apps": FolderOpen,
  "Bring your own models and keys": KeyRound,
};

export default function Pricing() {
  return (
    <PageShell
      closing={<Finale title="Choose Stella and get started" note="Free. No credit card, no trial." />}
    >
      <section className={`${pg.hero} ${pg.center} ${pr.hero}`} data-tone="light" data-bg="#ffffff">
        <p className={pg.eyebrow}>Pricing</p>
        <h1 className={pg.title}>Choose your plan</h1>
        <p className={pg.lede}>Pick the usage and capabilities you need.</p>
      </section>

      <section className={pr.plans} data-tone="light" data-bg="#ffffff" aria-label="Plans">
        <InView className={pr.grid} threshold={0.15}>
          {PLAN_ORDER.map((id, i) => {
            const plan = PLANS[id];
            const price = plan.monthlyPriceCents / 100;
            return (
              <article
                key={plan.label}
                className={pr.card}
                data-featured={plan.featured ? "1" : "0"}
                style={{ ["--i" as string]: i }}
              >
                <header className={pr.cardHead}>
                  <h2 className={pr.name}>{plan.label}</h2>
                  {plan.featured ? <span className={pr.badge}>Popular</span> : null}
                </header>
                <p className={pr.price}>
                  <span className={pr.amount}>${price}</span>
                  {price > 0 ? <span className={pr.period}>/mo</span> : null}
                </p>
                <p className={pr.tagline}>{plan.tagline}</p>
                <ul className={pr.features}>
                  {plan.features.map((f) => (
                    <li key={f}>
                      <Check size={16} strokeWidth={2.6} aria-hidden="true" />
                      {f}
                    </li>
                  ))}
                </ul>
              </article>
            );
          })}
        </InView>
      </section>

      <section className={pr.included} data-tone="light" data-bg="#f1f1f4" aria-labelledby="included-title">
        <div className={pr.includedHead}>
          <h2 id="included-title" className={pg.h2}>
            Every plan includes
          </h2>
          <p className={pr.includedNote}>
            Every tier includes browser, desktop, and mobile access, with different usage limits for
            assistant, research, browser, and file tools.
          </p>
        </div>
        <InView className={pr.tiles}>
          {INCLUDED_IN_EVERY_PLAN.map((label, i) => {
            const Icon = INCLUDED_ICONS[label];
            return (
            <div key={label} className={pr.tile} style={{ ["--i" as string]: i }}>
              <span className={pr.tileIcon}>
                <Icon size={22} strokeWidth={1.8} aria-hidden="true" />
              </span>
              <p>{label}</p>
            </div>
            );
          })}
        </InView>
      </section>
    </PageShell>
  );
}
