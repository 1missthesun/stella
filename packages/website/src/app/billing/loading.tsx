import type { CSSProperties } from "react";
import { BillingShell } from "./billing-shell";

export default function BillingLoading() {
  return (
    <BillingShell>
      <main className="billing-root" aria-busy="true">
        <div className="billing-shell">
          <header className="billing-hero">
            <p className="billing-eyebrow">Account</p>
            <h1 className="billing-title">
              Choose how much <em>Stella</em>.
            </h1>
            <p className="billing-lead">
              Monthly plans. Change or cancel anytime. Prices in USD.
            </p>
          </header>
          <section className="billing-account" aria-label="Loading account">
            <div className="billing-identity">
              <span className="billing-avatar" aria-hidden="true" />
              <div className="billing-identity-text">
                <span
                  className="loading-text"
                  style={{ "--w": "16ch" } as CSSProperties}
                  aria-label="Loading account"
                />
              </div>
            </div>
            <div className="billing-account-body">
              <div className="billing-account-plan">
                <span className="billing-status-label">Current plan</span>
                <span className="billing-status-value">
                  <span
                    className="loading-text"
                    style={{ "--w": "6ch" } as CSSProperties}
                  />
                </span>
              </div>
            </div>
          </section>
        </div>
      </main>
    </BillingShell>
  );
}
