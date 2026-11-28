import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { EdgeDrag } from "../../desktop-rune/host/rune-jsx/props";
import { FullWindow } from "../../desktop-rune/ui/app/FullWindow";
import { chatAtEnd, chatFit } from "../../desktop-rune/ui/chat/chat-at-end";
import { ToastPlacementContext } from "../../desktop-rune/ui/kit/Toast";
import { useTokens, WindowPaintsBackground } from "../../desktop-rune/ui/theme";
import type { HostElement } from "../../desktop-rune/host/reconciler";
import { usePhoneInsets } from "./phone/insets";
import { barBase, PHONE_TOPBAR_H } from "./phone/PhoneChrome";
import { phoneNav, usePhoneNav, type PhoneDrawer } from "./phone/nav";
import { CLOSE_SPRING, drawerProgress, drawerTravel, noteWindowSize, OPEN_SPRING, setDrawerHost, signOf, stageLook, useStageBackground, useWindowSize } from "./phone/stage";
import { ConnectComputerLayer } from "./computer/ConnectComputer";


/**
 * The phone's window: the shared Stella app (desktop-rune's FullWindow, with the phone's
 * navigation in place of the desktop top bar) between the status bar and the bottom bar.
 *
 * The keyboard moves it as the React Native app's ChatPane does, frame by frame in the engine
 * (`keyboard` prop: insets.keyboard here is only where the keyboard is headed, heard as it starts). A chat resting on its latest
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
  // One element for the life of the window, so a keyboard move re-lays out the app without
  // re-rendering it.
  const app = useMemo(() => <FullWindow />, []);
  const rides = useRef(true);
  const lastKeyboard = useRef(0);
  // As the keyboard starts to rise: a chat at its end rides up with it, after the keyboard has
  // taken the empty space under its last message (a short chat stays put, as in React Native).
  const slack = useRef(0);
  if (lastKeyboard.current < 1 && insets.keyboard >= 1) {
    rides.current = chatAtEnd.current;
    slack.current = chatFit.slack;
  }
  lastKeyboard.current = insets.keyboard;
  const base = barBase(insets);
  // Toasts sit under the status bar and the top bar, across the screen's width.
  const toastPlace = useMemo(() => ({ top: insets.top + PHONE_TOPBAR_H + 4, left: insets.left + 12, right: insets.right + 12 }), [insets.top, insets.left, insets.right]);
  useEffect(() => {
    document.documentElement.dataset.stellaPhone = "true";
  }, []);

  const { drawer, shown, drag } = usePhoneNav();
  const size = useWindowSize();
  const travel = drawerTravel(size.w);
  const swipe = useDrawerSwipe(size.w, travel);
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
        edgeDrag={swipe.zones}
        onEdgeDrag={swipe.zones ? swipe.onEdgeDrag : undefined}
        onSize={(r) => noteWindowSize(r.w, r.h)}
      >
        <col
          id="phone-safe-area"
          w="full"
          h="full"
          pt={insets.top}
          pb={base}
          pl={insets.left}
          pr={insets.right}
          keyboard={rides.current ? { lift: base, slack: slack.current } : { pad: [base, 0] }}
        >
          <WindowPaintsBackground.Provider value>
            <ToastPlacementContext.Provider value={toastPlace}>{app}</ToastPlacementContext.Provider>
          </WindowPaintsBackground.Provider>
        </col>
      </col>
      <ConnectComputerLayer />
    </window>
  );
}

/**
 * packages/mobile's open pan (useDrawerOpenPan): a sideways swipe anywhere on the page pulls a
 * drawer open with the finger, the account drawer from the left on every tab and chat settings
 * from the right on the chat. Let go past half the travel (a flick carries ahead), it opens;
 * short of it, it shuts. A row that scrolls sideways keeps its own pan.
 */
function useDrawerSwipe(width: number, travel: number) {
  const { tab, drawer } = usePhoneNav();
  const swipe = useRef<{ side: Exclude<PhoneDrawer, null>; sign: number; samples: [number, number][] } | null>(null);
  const [swiping, setSwiping] = useState(false);
  const onEdgeDrag = useCallback(
    (d: EdgeDrag) => {
      if (d.phase === "start") {
        const nav = phoneNav.get();
        const side = d.edge === "left" ? "account" : "chat-settings";
        if (nav.drawer || (side === "chat-settings" && nav.tab !== "chat")) return;
        swipe.current = { side, sign: signOf(side), samples: [[performance.now(), 0]] };
        setSwiping(true);
        phoneNav.swipeDrawer(side, travel);
        return;
      }
      const s = swipe.current;
      if (!s) return;
      const along = s.sign * d.dx;
      if (d.phase === "move") {
        s.samples.push([performance.now(), along]);
        if (s.samples.length > 5) s.samples.shift();
        phoneNav.dragDrawer(travel - along);
        return;
      }
      swipe.current = null;
      setSwiping(false);
      if (d.cancelled) return phoneNav.closeDrawer();
      const [t0, a0] = s.samples[0];
      const dt = performance.now() - t0;
      phoneNav.releaseSwipe(travel, dt > 0 ? ((along - a0) / dt) * 1000 : 0);
    },
    [travel],
  );
  const zones = drawer && !swiping ? undefined : { left: width, ...(tab === "chat" ? { right: width } : {}) };
  return { zones, onEdgeDrag };
}
