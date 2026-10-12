import type { Metadata } from "next";
import { LegalDoc } from "@/components/landing/legal-doc";
import { LEGAL_TITLES, PRIVACY_POLICY } from "@/lib/legal-text";

export const metadata: Metadata = {
  title: LEGAL_TITLES.privacy,
  description:
    "How FromYou LLC handles information when you use Stella, including the browser experience, desktop app, mobile app, backend services, and related websites or APIs.",
  alternates: {
    canonical: "/privacy",
  },
};

export default function PrivacyPage() {
  return <LegalDoc title={LEGAL_TITLES.privacy} source={PRIVACY_POLICY} />;
}
