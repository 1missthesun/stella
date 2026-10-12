import type { ReactNode } from "react";
import { Backdrop } from "./backdrop";
import { LandingFooter } from "./closing";
import { landingFontVars } from "./fonts";
import { LandingHeader } from "./landing-header";
import l from "./landing.module.css";

export function PageShell({
  children,
  closing,
  className,
}: {
  children: ReactNode;
  closing?: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={[l.root, landingFontVars, className].filter(Boolean).join(" ")}
      data-landing-root=""
      data-native-scroll=""
    >
      <Backdrop />
      <LandingHeader getHref={closing ? "#get" : "/#get"} />
      <main>
        {children}
        {closing}
      </main>
      <LandingFooter />
    </div>
  );
}
