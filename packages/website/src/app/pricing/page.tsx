import type { Metadata } from "next";
import Link from "next/link";
import {
  Bot,
  Check,
  FolderOpen,
  KeyRound,
  MonitorSmartphone,
  Plus,
  Wand2,
  type LucideIcon,
} from "lucide-react";
import { Finale } from "@/components/landing/closing";
import { InView } from "@/components/landing/in-view";
import { PageShell } from "@/components/landing/page-shell";
import pg from "@/components/landing/page.module.css";
import f from "@/components/landing/faq.module.css";
import {
  FEATURED_PLAN,
  INCLUDED_IN_EVERY_PLAN,
  PLAN_CATALOG,
  PLAN_ORDER,
  formatPlanPrice,
  formatUsd,
  planSummary,
} from "@/lib/plans";
import { BudgetVisual, PaceVisual } from "./budget-visuals";
import pr from "./pricing.module.css";

export const metadata: Metadata = {
  title: "Pricing",
  description: `Stella plans: ${PLAN_ORDER.map(planSummary).join("; ")}. One usage budget pays for everything Stella runs for you.`,
  alternates: { canonical: "/pricing" },
};

const INCLUDED_ICONS: Record<(typeof INCLUDED_IN_EVERY_PLAN)[number], LucideIcon> = {
  "Desktop, web and mobile apps": MonitorSmartphone,
  "Change Stella by asking it": Wand2,
  "Work with your files and apps": FolderOpen,
  "Use your own Claude or ChatGPT subscription": Bot,
  "Bring your own models and keys": KeyRound,
  "Top up with extra credit anytime": Plus,
};

const plus = PLAN_CATALOG.plus.budget;

const QUESTIONS = [
  {
    q: "What does the usage budget pay for?",
    a: "Everything Stella runs for you on its own servers: its models, cloud agents and the computers they use, image, video, music and 3D, voice, web search, maps, the cloud browser, and hosted apps. It all draws from one budget, so you spend it on whatever you use most.",
  },
  {
    q: "What happens when I run out?",
    a: `Stella pauses until your budget resets. Add extra credit to keep going right away, or move to a bigger plan. To make a month last, any ${plus.rollingWindowHours} hours can use up to 20% of it and any week up to 50%.`,
  },
  {
    q: "Do my own models count against it?",
    a: "No. When Stella runs on your own Claude or ChatGPT subscription, your API keys, or a local model, those runs don't touch your budget.",
  },
  {
    q: "Can I change or cancel?",
    a: "Anytime, from Plan & usage in the app or stella.sh/billing. Upgrades start right away; cancelling keeps your plan until the end of the month you paid for.",
  },
] as const;

export default function Pricing() {
  return (
    <PageShell closing={<Finale title="Choose Stella and get started" note="Free to start. No credit card." />}>
      <section className={`${pg.hero} ${pg.center} ${pr.hero}`} data-tone="light" data-bg="#ffffff">
        <p className={pg.eyebrow}>Pricing</p>
        <h1 className={pg.title}>One budget for everything</h1>
      </section>

      <section className={pr.plans} data-tone="light" data-bg="#ffffff" aria-label="Plans">
        <InView className={pr.table} threshold={0.15}>
          {PLAN_ORDER.map((id, i) => {
            const plan = PLAN_CATALOG[id];
            const featured = id === FEATURED_PLAN;
            return (
              <article key={id} className={pr.col} data-featured={featured ? "1" : "0"} style={{ ["--i" as string]: i }}>
                <header className={pr.colHead}>
                  <h2 className={pr.name}>{plan.label}</h2>
                  {featured ? <span className={pr.badge}>Most popular</span> : null}
                </header>
                <p className={pr.price}>
                  <span className={pr.amount}>{formatPlanPrice(plan.monthlyPriceCents)}</span>
                  <span className={pr.period}>{plan.interval ? "/ month" : "forever"}</span>
                </p>
                <p className={pr.budget}>
                  {plan.interval ? (
                    <>
                      <b>{formatUsd(plan.budget.monthlyUsd)}</b> of usage every month
                    </>
                  ) : (
                    <>
                      <b>{formatUsd(plan.budget.oneTimeUsd ?? plan.budget.monthlyUsd)}</b> of usage to try it
                    </>
                  )}
                </p>
                {plan.interval ? (
                  <Link className={featured ? pr.ctaPrimary : pr.cta} href={`/billing?plan=${id}`}>
                    Choose {plan.label}
                  </Link>
                ) : (
                  <Link className={pr.cta} href="#get">
                    Get Stella
                  </Link>
                )}
                <ul className={pr.features}>
                  {plan.includes.slice(1).map((line) => (
                    <li key={line}>
                      <Check size={15} strokeWidth={2.4} aria-hidden="true" />
                      {line}
                    </li>
                  ))}
                </ul>
              </article>
            );
          })}
        </InView>
      </section>

      <section className={`${pg.split} ${pr.act}`} data-tone="light" data-bg="#f1f1f4" aria-labelledby="budget-title">
        <div className={pg.copy}>
          <h2 id="budget-title" className={pg.h2}>
            Spend it on anything
          </h2>
          <p>Models, agents, images, voice. One pool, no separate meters.</p>
        </div>
        <div className={pr.stage}>
          <BudgetVisual />
        </div>
      </section>

      <section className={`${pg.split} ${pg.flip} ${pr.act}`} data-tone="light" data-bg="#f1f1f4" aria-labelledby="pace-title">
        <div className={pg.copy}>
          <h2 id="pace-title" className={pg.h2}>
            Paced to last the month
          </h2>
          <p>Short limits reset in hours, not weeks. Extra credit covers the gap.</p>
        </div>
        <div className={pr.stage}>
          <PaceVisual />
        </div>
      </section>

      <section className={pr.included} data-tone="light" data-bg="#ffffff" aria-labelledby="included-title">
        <div className={pr.includedHead}>
          <h2 id="included-title" className={pg.h2}>
            Every plan includes
          </h2>
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

      <section className={f.faq} data-tone="light" data-bg="#ffffff" aria-labelledby="pricing-faq-title">
        <div className={f.head}>
          <h2 id="pricing-faq-title" className={f.title}>
            Questions.
          </h2>
        </div>
        <div className={f.list}>
          {QUESTIONS.map((item, i) => (
            <details key={item.q} className={f.item} open={i === 0}>
              <summary className={f.q}>
                <span>{item.q}</span>
                <i className={f.icon} aria-hidden="true" />
              </summary>
              <div className={f.a}>
                <p>{item.a}</p>
              </div>
            </details>
          ))}
        </div>
      </section>
    </PageShell>
  );
}
