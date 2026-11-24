import type { DemoStep } from "@/lib/demo";
import { StellaDemoPlayer } from "./stella-demo-player";

const ARM_SCRIPT = `(function(){var f=document.currentScript&&document.currentScript.previousElementSibling;if(!f)return;if(matchMedia("(prefers-reduced-motion: reduce)").matches){var s=f.querySelector(".session-content");if(s)s.scrollTop=s.scrollHeight;return}f.setAttribute("data-armed","");var h=new Date().getHours();var g=f.querySelector(".home-stella-title");if(g)g.textContent=h<5?"Good night":h<12?"Good morning":h<17?"Good afternoon":h<21?"Good evening":"Good night"})()`;

export function StellaDemo(props: { steps: DemoStep[]; theme?: "dark" | "light"; label: string }) {
  return (
    <>
      <StellaDemoPlayer {...props} />
      <script dangerouslySetInnerHTML={{ __html: ARM_SCRIPT }} />
    </>
  );
}
