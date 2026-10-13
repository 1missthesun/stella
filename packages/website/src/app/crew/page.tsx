import type { Metadata } from "next";
import { LandingFooter } from "@/components/landing/closing";
import { landingFontVars } from "@/components/landing/fonts";
import { LandingHeader } from "@/components/landing/landing-header";
import l from "@/components/landing/landing.module.css";
import { CrewClient } from "./crew-client";
import s from "./crew.module.css";

export const metadata: Metadata = {
  title: "Crew",
  description:
    "Stella Crew puts Stella in your Slack workspace. Tag @Stella in any channel or DM her, and set how she works for your team.",
  robots: { index: false, follow: false },
};

export default function CrewPage() {
  return (
    <div className={`${l.root} ${landingFontVars} ${s.root}`} data-landing-root="" data-native-scroll="">
      <LandingHeader getHref="/#get" />
      <main className={s.main}>
        <CrewClient />
      </main>
      <LandingFooter />
    </div>
  );
}
