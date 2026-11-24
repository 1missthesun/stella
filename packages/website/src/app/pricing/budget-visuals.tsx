"use client";

import { useRef } from "react";
import { ease, seg, usePlayOnce } from "@/components/landing/motion";
import { BUDGET_COVERS, PLAN_CATALOG, planPriceLabel } from "@/lib/plans";
import pr from "./pricing.module.css";

const percent = (used: number, limit: number) => `${Math.round(Math.min(1, used / limit) * 100)}%`;

const SPEND_COLORS = ["#703cff", "#00a3ff", "#ff4ac0", "#ff9d2e", "#13b37a", "#8b8b95"];
// What a month of Pro might look like, in the order of BUDGET_COVERS.
const SAMPLE_SPEND = [7.4, 4.85, 3.2, 1.15, 0.9, 0.55];

export function BudgetVisual() {
  const ref = useRef<HTMLDivElement>(null);
  const totalRef = useRef<HTMLSpanElement>(null);
  const segRefs = useRef<(HTMLSpanElement | null)[]>([]);
  const legendItemRefs = useRef<(HTMLLIElement | null)[]>([]);
  const legendPctRefs = useRef<(HTMLSpanElement | null)[]>([]);
  const lastTotal = useRef("");
  const lastSegPct = useRef<string[]>([]);

  const plan = PLAN_CATALOG.pro;
  const limit = plan.budget.monthlyUsd;

  usePlayOnce(
    ref,
    2200,
    (t) => {
      let used = 0;
      for (let i = 0; i < BUDGET_COVERS.length; i += 1) {
        const local = ease.out(seg(t, i * 0.09, 0.45 + i * 0.09));
        const amount = SAMPLE_SPEND[i] * local;
        used += amount;
        const bar = segRefs.current[i];
        if (bar) bar.style.width = `${((amount / limit) * 100).toFixed(3)}%`;
        const li = legendItemRefs.current[i];
        if (li) li.style.opacity = (0.35 + 0.65 * seg(t, i * 0.09, 0.3 + i * 0.09)).toFixed(3);
        const pct = percent(amount, limit);
        if (lastSegPct.current[i] !== pct) {
          lastSegPct.current[i] = pct;
          const pctEl = legendPctRefs.current[i];
          if (pctEl) pctEl.textContent = pct;
        }
      }
      const totalPct = percent(used, limit);
      if (lastTotal.current !== totalPct) {
        lastTotal.current = totalPct;
        if (totalRef.current) totalRef.current.textContent = totalPct;
      }
    },
    0.35,
  );

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
          <span ref={totalRef} className={pr.panelAmount}>0%</span>
          <span className={pr.panelMuted}>used this month</span>
        </div>
        <div className={pr.stack} aria-hidden="true">
          {BUDGET_COVERS.map((label, i) => (
            <span
              key={label}
              ref={(el) => {
                segRefs.current[i] = el;
              }}
              style={{ width: "0%", background: SPEND_COLORS[i] }}
            />
          ))}
        </div>
        <ul className={pr.legend}>
          {BUDGET_COVERS.map((label, i) => (
            <li
              key={label}
              ref={(el) => {
                legendItemRefs.current[i] = el;
              }}
              style={{ opacity: 0.35 }}
            >
              <i style={{ background: SPEND_COLORS[i] }} aria-hidden="true" />
              <span>{label}</span>
              <span
                ref={(el) => {
                  legendPctRefs.current[i] = el;
                }}
                className={pr.legendAmount}
              >
                0%
              </span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

export function PaceVisual() {
  const ref = useRef<HTMLDivElement>(null);
  const pctRefs = useRef<(HTMLSpanElement | null)[]>([]);
  const barRefs = useRef<(HTMLSpanElement | null)[]>([]);
  const resetRefs = useRef<(HTMLSpanElement | null)[]>([]);
  const creditRef = useRef<HTMLDivElement>(null);
  const lastPct = useRef<string[]>([]);
  const lastFull = useRef<boolean[]>([]);

  const budget = PLAN_CATALOG.plus.budget;
  const windows = [
    { label: `Next ${budget.rollingWindowHours} hours`, target: 1, limit: budget.rollingUsd, reset: "Resets 4:10 PM" },
    { label: "This week", target: 0.62, limit: budget.weeklyUsd, reset: "Resets Monday" },
    { label: "This month", target: 0.38, limit: budget.monthlyUsd, reset: "Resets Nov 3" },
  ];

  usePlayOnce(
    ref,
    2600,
    (t) => {
      const fill = ease.inOut(seg(t, 0.05, 0.6));
      for (let i = 0; i < windows.length; i += 1) {
        const w = windows[i];
        const used = w.limit * w.target * fill;
        const full = used >= w.limit - 0.001;
        const bar = barRefs.current[i];
        if (bar) {
          bar.style.width = `${((used / w.limit) * 100).toFixed(3)}%`;
          if (full) bar.setAttribute("data-full", "");
          else bar.removeAttribute("data-full");
        }
        const pctText = `${percent(used, w.limit)} used`;
        if (lastPct.current[i] !== pctText) {
          lastPct.current[i] = pctText;
          const pctEl = pctRefs.current[i];
          if (pctEl) pctEl.textContent = pctText;
        }
        if (lastFull.current[i] !== full) {
          lastFull.current[i] = full;
          const resetEl = resetRefs.current[i];
          if (resetEl) {
            resetEl.textContent = full ? `Used up · ${w.reset}` : w.reset;
            if (full) resetEl.setAttribute("data-full", "");
            else resetEl.removeAttribute("data-full");
          }
        }
      }
      const credit = ease.out(seg(t, 0.68, 0.95));
      if (creditRef.current) {
        creditRef.current.style.opacity = credit.toFixed(3);
        creditRef.current.style.transform = `translateY(${((1 - credit) * 10).toFixed(2)}px)`;
      }
    },
    0.35,
  );

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
        {windows.map((w, i) => (
          <div key={w.label} className={pr.meter}>
            <div className={pr.meterHead}>
              <span>{w.label}</span>
              <span
                ref={(el) => {
                  pctRefs.current[i] = el;
                }}
                className={pr.panelMuted}
              >
                0% used
              </span>
            </div>
            <div className={pr.meterTrack}>
              <span
                ref={(el) => {
                  barRefs.current[i] = el;
                }}
                style={{ width: "0%" }}
              />
            </div>
            <span
              ref={(el) => {
                resetRefs.current[i] = el;
              }}
              className={pr.meterReset}
            >
              {w.reset}
            </span>
          </div>
        ))}
        <div ref={creditRef} className={pr.creditRow} style={{ opacity: 0, transform: "translateY(10px)" }}>
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
