import type { Metadata } from "next";
import { Backdrop } from "@/components/landing/backdrop";
import { LandingFooter } from "@/components/landing/closing";
import { landingFontVars } from "@/components/landing/fonts";
import { LandingHeader } from "@/components/landing/landing-header";
import l from "@/components/landing/landing.module.css";
import { SecurityHero } from "@/components/security/hero";
import { NewsAct, PrivacyAct, SecurityFaq, SecurityFinale, WhatItDoes } from "@/components/security/sections";
import s from "@/components/security/security.module.css";
import { SECURITY_DESCRIPTION, SECURITY_PATH, SECURITY_TITLE } from "@/lib/security";

export const metadata: Metadata = {
  title: { absolute: SECURITY_TITLE },
  description: SECURITY_DESCRIPTION,
  alternates: { canonical: SECURITY_PATH, types: { "text/markdown": `${SECURITY_PATH}.md` } },
  openGraph: { title: SECURITY_TITLE, description: SECURITY_DESCRIPTION, url: SECURITY_PATH },
  twitter: { card: "summary_large_image", title: SECURITY_TITLE, description: SECURITY_DESCRIPTION },
};

export default function SecurityPage() {
  return (
    <div className={`${l.root} ${landingFontVars}`} data-landing-root="" data-native-scroll="">
      <Backdrop />
      <LandingHeader />
      <main className={s.main}>
        <SecurityHero />
        <WhatItDoes />
        <NewsAct />
        <PrivacyAct />
        <SecurityFaq />
        <SecurityFinale />
      </main>
      <LandingFooter />
    </div>
  );
}
