import { useEffect, useMemo } from "react";
import { FullWindow } from "../../desktop-rune/ui/app/FullWindow";
import { usePhoneInsets } from "./phone/insets";
import { barSpace } from "./phone/PhoneChrome";

/**
 * The phone's window: the shared Stella app (desktop-rune's FullWindow, with the phone's
 * navigation in place of the desktop top bar) between the status bar and the bottom bar, or
 * the keyboard while it's up, so the composer always sits just above whichever is there.
 */
export function PhoneRoot() {
  const insets = usePhoneInsets();
  // One element for the life of the window, so the keyboard moving the insets each frame re-lays
  // out the app without re-rendering it.
  const app = useMemo(() => <FullWindow />, []);
  useEffect(() => {
    document.documentElement.dataset.stellaPhone = "true";
  }, []);
  return (
    <window id="main">
      <col id="phone-safe-area" w="full" h="full" pt={insets.top} pb={barSpace(insets)} pl={insets.left} pr={insets.right}>
        {app}
      </col>
    </window>
  );
}
