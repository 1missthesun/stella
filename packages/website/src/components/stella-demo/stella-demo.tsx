import type { DemoStep } from "@/lib/demo";
import { StellaDemoPlayer } from "./stella-demo-player";

const ARM_SCRIPT = `(function(){var f=document.currentScript&&document.currentScript.previousElementSibling;if(!f)return;if(matchMedia("(prefers-reduced-motion: reduce)").matches){var s=f.querySelector(".session-content");if(s)s.scrollTop=s.scrollHeight;return}f.setAttribute("data-armed","")})()`;

export function StellaDemo(props: { steps: DemoStep[]; theme?: "dark" | "light"; label: string }) {
  return (
    <>
      <StellaDemoPlayer {...props} />
      <script dangerouslySetInnerHTML={{ __html: ARM_SCRIPT }} />
    </>
  );
}
