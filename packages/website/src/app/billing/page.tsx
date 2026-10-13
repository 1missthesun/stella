import type { Metadata } from "next";
import { BillingShell } from "./billing-shell";
import { BillingClient } from "./billing-client";

export const metadata: Metadata = {
  title: "Account",
  description:
    "Choose a Stella plan. Go raises your usage limits; Pro adds image, video, 3D and voice generation plus orchestrator mode.",
  robots: { index: false, follow: true },
};

export default function BillingPage() {
  return (
    <BillingShell>
      <BillingClient />
    </BillingShell>
  );
}
