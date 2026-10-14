"use client";

import { useRef, useState } from "react";
import { ease, seg, usePlayOnce } from "@/components/landing/motion";
import { BUDGET_COVERS, PLAN_CATALOG, formatUsd, planPriceLabel } from "@/lib/plans";
import pr from "./pricing.module.css";

const usd = (value: number) => `$${value.toFixed(2)}`;

const SPEND_COLORS = ["#703cff", "#00a3ff", "#ff4ac0", "#ff9d2e", "#13b37a", "#8b8b95"];
// What a month of Pro might look like, in the order of BUDGET_COVERS.
const SAMPLE_SPEND = [7.4, 4.85, 3.2, 1.15, 0.9, 0.55];

export function BudgetVisual() {
  const ref = useRef<HTMLDivElement>(null);
  const [t, setT] = useState(0);
  usePlayOnce(ref, 2200, setT, 0.35);

  const plan = PLAN_CATALOG.pro;
  const limit = plan.budget.monthlyUsd;
  const segments = BUDGET_COVERS.map((label, i) => {
    const local = ease.out(seg(t, i * 0.09, 0.45 + i * 0.09));
    return { label, color: SPEND_COLORS[i], amount: SAMPLE_SPEND[i] * local };
  });
  const used = segments.reduce((sum, s) => sum + s.amount, 0);

  return (
    <div ref={ref} className={pr.panel} aria-label={`Example: a month on ${plan.label}`} role="img">
      <div className={pr.panelBar}>
        <span className={pr.panelDots} aria-hidden="true">
          <i />
          <i />
          <i />
        </span>
        <span className={pr.panelTabs}>
          <b>Plan</b>
          <span>Usage</span>
        </span>
      </div>
      <div className={pr.panelBody}>
        <div className={pr.panelPlanRow}>
          <span className={pr.panelPlan}>{plan.label}</span>
          <span className={pr.panelMuted}>{planPriceLabel("pro")} · Renews Nov 3</span>
        </div>
        <div className={pr.panelBig}>
          <span className={pr.panelAmount}>{usd(used)}</span>
          <span className={pr.panelMuted}>of {formatUsd(limit)} this month</span>
        </div>
        <div className={pr.stack} aria-hidden="true">
          {segments.map((s) => (
            <span key={s.label} style={{ width: `${(s.amount / limit) * 100}%`, background: s.color }} />
          ))}
        </div>
        <ul className={pr.legend}>
          {segments.map((s, i) => (
            <li key={s.label} style={{ opacity: 0.35 + 0.65 * seg(t, i * 0.09, 0.3 + i * 0.09) }}>
              <i style={{ background: s.color }} aria-hidden="true" />
              <span>{s.label}</span>
              <span className={pr.legendAmount}>{usd(s.amount)}</span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

export function PaceVisual() {
  const ref = useRef<HTMLDivElement>(null);
  const [t, setT] = useState(0);
  usePlayOnce(ref, 2600, setT, 0.35);

  const budget = PLAN_CATALOG.plus.budget;
  const fill = ease.inOut(seg(t, 0.05, 0.6));
  const windows = [
    { label: `Next ${budget.rollingWindowHours} hours`, used: budget.rollingUsd * fill, limit: budget.rollingUsd, reset: "Resets 4:10 PM" },
    { label: "This week", used: budget.weeklyUsd * 0.62 * fill, limit: budget.weeklyUsd, reset: "Resets Monday" },
    { label: "This month", used: budget.monthlyUsd * 0.38 * fill, limit: budget.monthlyUsd, reset: "Resets Nov 3" },
  ];
  const credit = ease.out(seg(t, 0.68, 0.95));

  return (
    <div ref={ref} className={pr.panel} aria-label="Example: usage windows on Plus" role="img">
      <div className={pr.panelBar}>
        <span className={pr.panelDots} aria-hidden="true">
          <i />
          <i />
          <i />
        </span>
        <span className={pr.panelTabs}>
          <b>Plan</b>
          <span>Usage</span>
        </span>
      </div>
      <div className={pr.panelBody}>
        {windows.map((w) => {
          const full = w.used >= w.limit - 0.001;
          return (
            <div key={w.label} className={pr.meter}>
              <div className={pr.meterHead}>
                <span>{w.label}</span>
                <span className={pr.panelMuted}>
                  {usd(w.used)} of {formatUsd(w.limit)}
                </span>
              </div>
              <div className={pr.meterTrack}>
                <span data-full={full ? "" : undefined} style={{ width: `${(w.used / w.limit) * 100}%` }} />
              </div>
              <span className={pr.meterReset} data-full={full ? "" : undefined}>
                {full ? `Used up · ${w.reset}` : w.reset}
              </span>
            </div>
          );
        })}
        <div className={pr.creditRow} style={{ opacity: credit, transform: `translateY(${(1 - credit) * 10}px)` }}>
          <span>
            <b>Extra credit</b>
            <span className={pr.panelMuted}>Keeps you going until the reset</span>
          </span>
          <span className={pr.creditAmount}>$10.00</span>
        </div>
      </div>
    </div>
  );
}
