import { BillingShell } from "./billing-shell";

export default function BillingLoading() {
  return (
    <BillingShell>
      <main className="billing-main" aria-busy="true">
        <div className="billing-shell">
          <header className="billing-head">
            <div>
              <h1 className="billing-title">Plan &amp; usage</h1>
              <p className="billing-lede">&nbsp;</p>
            </div>
          </header>
          <div className="billing-loading" aria-live="polite">
            <span className="billing-spinner" aria-hidden="true" />
            Loading
          </div>
        </div>
      </main>
    </BillingShell>
  );
}
