import type { Metadata } from "next";
import { BillingShell } from "./billing-shell";
import { BillingClient } from "./billing-client";

export const metadata: Metadata = {
  title: "Plan & usage",
  description: "See your Stella usage, change your plan, and add extra credit.",
  robots: { index: false, follow: true },
};

export default function BillingPage() {
  return (
    <BillingShell>
      <BillingClient />
    </BillingShell>
  );
}
