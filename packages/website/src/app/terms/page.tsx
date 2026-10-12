import type { Metadata } from "next";
import { LegalDoc } from "@/components/landing/legal-doc";
import { LEGAL_TITLES, TERMS_OF_SERVICE } from "@/lib/legal-text";

export const metadata: Metadata = {
  title: LEGAL_TITLES.terms,
  description:
    "Terms governing your use of Stella, including the browser experience, desktop application, mobile app, backend services, and related websites or APIs.",
  alternates: {
    canonical: "/terms",
  },
};

export default function TermsPage() {
  return <LegalDoc title={LEGAL_TITLES.terms} source={TERMS_OF_SERVICE} />;
}
