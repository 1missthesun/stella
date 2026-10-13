import type { Metadata } from "next";
import { LandingFooter } from "@/components/landing/closing";
import { landingFontVars } from "@/components/landing/fonts";
import { LandingHeader } from "@/components/landing/landing-header";
import l from "@/components/landing/landing.module.css";
import { SlackClient } from "./slack-client";
import s from "./slack.module.css";

export const metadata: Metadata = {
  title: "Stella Crew",
  description:
    "Add Stella to your Slack workspace. Tag @Stella in any channel or DM her, and choose how she works for your team.",
  robots: { index: false, follow: false },
};

export default function SlackPage() {
  return (
    <div className={`${l.root} ${landingFontVars} ${s.root}`} data-landing-root="" data-native-scroll="">
      <LandingHeader getHref="/#get" />
      <main className={s.main}>
        <SlackClient />
      </main>
      <LandingFooter />
    </div>
  );
}
