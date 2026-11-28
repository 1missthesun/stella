import { useCallback, useEffect, useMemo, useRef } from "react";
import { FullWindow } from "../../desktop-rune/ui/app/FullWindow";
import { chatAtEnd } from "../../desktop-rune/ui/chat/chat-at-end";
import { ToastPlacementContext } from "../../desktop-rune/ui/kit/Toast";
import { useTokens, WindowPaintsBackground } from "../../desktop-rune/ui/theme";
import type { HostElement } from "../../desktop-rune/host/reconciler";
import { usePhoneInsets } from "./phone/insets";
import { barBase, barSpace, PHONE_TOPBAR_H } from "./phone/PhoneChrome";
import { usePhoneNav } from "./phone/nav";
import { CLOSE_SPRING, drawerProgress, drawerTravel, noteWindowSize, OPEN_SPRING, setDrawerHost, signOf, stageLook, useStageBackground, useWindowSize } from "./phone/stage";
import { ConnectComputerLayer } from "./computer/ConnectComputer";


/**
 * The phone's window: the shared Stella app (desktop-rune's FullWindow, with the phone's
 * navigation in place of the desktop top bar) between the status bar and the bottom bar.
 *
 * The keyboard moves it as the React Native app's ChatPane does. A chat resting on its latest
 * message rides up with the keyboard whole, list and composer together, so the messages above the
 * composer stay in view; one scrolled back keeps its place while the composer rises over the
 * keyboard and the list's bottom gives way to it. Which one is decided as the keyboard starts up.
 *
 * The app is the page of packages/mobile's DrawerStage: a drawer opens behind it (in
 * `phone-drawer-host`, where PhoneChrome portals the drawers) and the page moves aside, shrinking
 * and veiled, so the drawer is never drawn over it.
 */
export function PhoneRoot() {
  const insets = usePhoneInsets();
  const t = useTokens();
  // One element for the life of the window, so the keyboard moving the insets each frame re-lays
  // out the app without re-rendering it.
  const app = useMemo(() => <FullWindow />, []);
  const rides = useRef(true);
  const lastKeyboard = useRef(0);
  if (lastKeyboard.current < 1 && insets.keyboard >= 1) rides.current = chatAtEnd.current;
  lastKeyboard.current = insets.keyboard;
  const base = barBase(insets);
  const lift = Math.max(0, insets.keyboard - base);
  // Toasts sit under the status bar and the top bar, across the screen's width.
  const toastPlace = useMemo(() => ({ top: insets.top + PHONE_TOPBAR_H + 4, left: insets.left + 12, right: insets.right + 12 }), [insets.top, insets.left, insets.right]);
  useEffect(() => {
    document.documentElement.dataset.stellaPhone = "true";
  }, []);

  const { drawer, shown, drag } = usePhoneNav();
  const size = useWindowSize();
  const travel = drawerTravel(size.w);
  const live = shown !== null;
  const v = drawerProgress(drawer !== null, drag, travel);
  const sign = signOf(shown);
  const stage = stageLook(v, sign, travel);
  // Only while a drawer is out: an element's motion reaches every change beneath it (the keyboard
  // ride, the whole app), which must otherwise land at once.
  const motion = drag !== null || !live ? undefined : drawer ? OPEN_SPRING : CLOSE_SPRING;
  const stageBg = useStageBackground();
  const hostRef = useCallback((el: HostElement | null) => setDrawerHost(el), []);

  return (
    <window id="main">
      <col id="phone-drawer-host" ref={hostRef} absolute={{ left: 0, top: 0, right: 0, bottom: 0 }} hidden={!live} />
      <col
        id="phone-stage"
        w="full"
        h="full"
        x={stage.x}
        scale={stage.scale}
        radius={live ? stage.radius : undefined}
        clip={live ? 0 : undefined}
        fill={live ? (stageBg ?? t.c.background) : undefined}
        motion={motion}
        onSize={(r) => noteWindowSize(r.w, r.h)}
      >
        <col id="phone-safe-area" w="full" h="full" pt={insets.top} pb={rides.current ? base : barSpace(insets)} pl={insets.left} pr={insets.right} y={rides.current ? -lift : 0}>
          <WindowPaintsBackground.Provider value>
            <ToastPlacementContext.Provider value={toastPlace}>{app}</ToastPlacementContext.Provider>
          </WindowPaintsBackground.Provider>
        </col>
      </col>
      <ConnectComputerLayer />
    </window>
  );
}
