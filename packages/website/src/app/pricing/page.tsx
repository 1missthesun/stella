import type { Metadata } from "next";
import { Check, FolderOpen, KeyRound, Mic, MonitorSmartphone, Paintbrush, Sparkles } from "lucide-react";
import { Finale } from "@/components/landing/closing";
import { InView } from "@/components/landing/in-view";
import { PageShell } from "@/components/landing/page-shell";
import pg from "@/components/landing/page.module.css";
import pr from "./pricing.module.css";

export const metadata: Metadata = {
  title: "Pricing",
  description:
    "Choose a Stella plan: Free, Go with 10x higher usage, or Pro with the highest usage limits, media generation, and multiple agents.",
  alternates: { canonical: "/pricing" },
};

// Mirrors `STATIC_PLAN_DISPLAY`, `PLAN_USAGE_TAGLINE` and `PLAN_FEATURES`
// in `src/app/billing/billing-client.tsx` so /pricing and /billing always
// describe the same plans. `PRICING_MD` in `src/lib/agent-pages.ts` mirrors
// this page for agents — update all three together.
//
// When the Go intro promo runs in the backend
// (`STELLA_GO_INTRO_FIRST_MONTH_PRICE_CENTS`), keep `introFirstMonthPriceUsd`
// here in sync so marketing matches `/billing`.
const plans: {
  name: string;
  price: number;
  /** Shown alongside recurring `price`; must match the backend intro cents ÷ 100. */
  introFirstMonthPriceUsd?: number;
  tagline: string;
  features: string[];
  featured?: boolean;
}[] = [
  {
    name: "Free",
    price: 0,
    tagline: "No credit card, no trial.",
    features: [
      "Coding agent",
      "Personal assistant",
      "Research and knowledge work",
      "Dictation and read-aloud",
    ],
  },
  {
    name: "Go",
    price: 5,
    tagline: "10× higher usage",
    features: ["Coding, assistant and research", "Dictation and read-aloud"],
  },
  {
    name: "Pro",
    price: 15,
    tagline: "The highest usage limits",
    featured: true,
    features: [
      "Image, video, 3D and voice generation",
      "Multiple agents working together",
    ],
  },
];

const included = [
  { label: "Browser, desktop, and mobile access", icon: MonitorSmartphone },
  { label: "Coding, assistant and research in one app", icon: Sparkles },
  { label: "Dictation and wake word on every tier", icon: Mic },
  { label: "Customizable interface", icon: Paintbrush },
  { label: "Work with files and apps", icon: FolderOpen },
  { label: "Bring your own models and keys", icon: KeyRound },
];

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
          {plans.map((plan, i) => {
            const intro =
              typeof plan.introFirstMonthPriceUsd === "number" &&
              plan.introFirstMonthPriceUsd > 0 &&
              plan.introFirstMonthPriceUsd < plan.price
                ? plan.introFirstMonthPriceUsd
                : null;
            return (
              <article
                key={plan.name}
                className={pr.card}
                data-featured={plan.featured ? "1" : "0"}
                style={{ ["--i" as string]: i }}
              >
                <header className={pr.cardHead}>
                  <h2 className={pr.name}>{plan.name}</h2>
                  {plan.featured ? <span className={pr.badge}>Popular</span> : null}
                </header>
                {intro !== null ? (
                  <div className={pr.priceBlock}>
                    <p className={pr.price}>
                      <span className={pr.amount}>${intro}</span>
                      <span className={pr.period}>first month</span>
                    </p>
                    <p className={pr.then}>
                      Then <strong>${plan.price}</strong>
                      <span aria-hidden="true">/mo</span> after that
                    </p>
                  </div>
                ) : (
                  <p className={pr.price}>
                    <span className={pr.amount}>${plan.price}</span>
                    {plan.price > 0 ? <span className={pr.period}>/mo</span> : null}
                  </p>
                )}
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
          {included.map(({ label, icon: Icon }, i) => (
            <div key={label} className={pr.tile} style={{ ["--i" as string]: i }}>
              <span className={pr.tileIcon}>
                <Icon size={22} strokeWidth={1.8} aria-hidden="true" />
              </span>
              <p>{label}</p>
            </div>
          ))}
        </InView>
      </section>
    </PageShell>
  );
}
