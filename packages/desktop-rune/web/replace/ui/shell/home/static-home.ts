import { useEffect } from "react";
import type { Tokens } from "../../../../../ui/theme";
import { STATIC_HOME_LOOK_KEY, staticHomeLook } from "../../../../static-home/palette";

/** Keeps the home's colours for the next cold load's pre-rendered home (web/static-home). */
export function useStaticHomeLook(tokens: Tokens): void {
  useEffect(() => {
    try {
      window.localStorage.setItem(STATIC_HOME_LOOK_KEY, JSON.stringify(staticHomeLook(tokens)));
    } catch {
      return;
    }
  }, [tokens]);
}
