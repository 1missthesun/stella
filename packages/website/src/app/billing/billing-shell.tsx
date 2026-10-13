import type { ReactNode } from "react";
import { LandingFooter } from "@/components/landing/closing";
import { landingFontVars } from "@/components/landing/fonts";
import { LandingHeader } from "@/components/landing/landing-header";
import l from "@/components/landing/landing.module.css";
import "./billing.css";

export function BillingShell({ children }: { children: ReactNode }) {
  return (
    <div
      className={`${l.root} ${landingFontVars} billing-page`}
      data-landing-root=""
      data-native-scroll=""
    >
      <div className="billing-chrome">
        <LandingHeader getHref="/#get" />
      </div>
      {children}
      <div className="billing-chrome">
        <LandingFooter />
      </div>
    </div>
  );
}
