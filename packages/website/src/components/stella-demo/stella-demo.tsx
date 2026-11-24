import type { DemoStep } from "@/lib/demo";
import { StellaDemoPlayer } from "./stella-demo-player";

/**
 * Runs as the page is parsed: shows the app's empty home screen (with the
 * visitor's time-of-day greeting) instead of the finished exchange, so the
 * first paint already matches where the replay starts. Without script, or
 * with reduced motion, the finished exchange stays, scrolled to its end.
 */
const ARM_SCRIPT = `(function(){var f=document.currentScript&&document.currentScript.previousElementSibling;if(!f)return;if(matchMedia("(prefers-reduced-motion: reduce)").matches){var s=f.querySelector(".session-content");if(s)s.scrollTop=s.scrollHeight;return}f.setAttribute("data-armed","");var h=new Date().getHours();var g=f.querySelector(".home-stella-title");if(g)g.textContent=h<5?"Good night":h<12?"Good morning":h<17?"Good afternoon":h<21?"Good evening":"Good night"})()`;

/**
 * Stella's desktop chat, drawn with the app's own styles, playing a guide's
 * exchange (see lib/demo.ts). The finished exchange is in the page's HTML, so
 * it reads without script, for search, and with reduced motion.
 */
export function StellaDemo(props: { steps: DemoStep[]; theme?: "dark" | "light"; label: string }) {
  return (
    <>
      <StellaDemoPlayer {...props} />
      <script dangerouslySetInnerHTML={{ __html: ARM_SCRIPT }} />
    </>
  );
}
