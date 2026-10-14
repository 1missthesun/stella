import type { Metadata } from "next";
import { LegalDoc } from "@/components/landing/legal-doc";
import { ACCOUNT_DELETION } from "@stella/contracts/legal-text";

export const metadata: Metadata = {
  title: "Delete your Stella account",
  description: "Delete a hosted Stella account in the app or request deletion by email without reinstalling Stella.",
  alternates: { canonical: "/delete-account" },
};

export default function DeleteAccountPage() {
  return <LegalDoc title="Delete your Stella account" source={ACCOUNT_DELETION} deletionRequest />;
}
