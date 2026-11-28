import { memo, useEffect, useLayoutEffect, useMemo, useState, type ReactNode } from "react";
import { setChatCovered, setPhoneSafeTop } from "../../../desktop-rune/ui/shell/phone";
import { useT } from "@/shared/i18n";
import { Icon, RetainedSurface } from "../../../desktop-rune/ui/kit";
import { alpha, useTokens } from "../../../desktop-rune/ui/theme";
import { TopInsetContext } from "../../../desktop-rune/ui/shell/top-inset";
import { elementPortal } from "../../../desktop-rune/host/reconciler";
import { usePhoneInsets, type PhoneInsets } from "./insets";
import { PHONE_TABS, phoneNav, usePhoneNav, type PhoneDrawer, type PhoneTab } from "./nav";
import { glyph, tabIcon } from "./icons";
import { PhoneViewScreen } from "./ViewScreen";
import { GlassCircle, BRAND_TOP, BRAND_ROW, TEXT, useRn } from "./rn";
import { StatusPill } from "./StatusPill";
import { blurTrack, DRAWER_RADIUS, DRAWER_SCALE, drawerTravel, held, pageTracks, panelTracks, sideOf, signOf, setStageBackground, stageFollow, useDrawerHost, useStage, useWindowSize, veilTrack, type Stage, type StageTracks } from "./stage";
import { AccountPanel } from "./AccountPanel";
import { ChatSettingsPanel } from "./ChatSettingsPanel";
import { SchedulePage } from "./pages/SchedulePage";
import { AppsPage } from "./pages/AppsPage";
import { FilesPage } from "./pages/FilesPage";
import { topBarOverride, useTopBarOverride } from "./topbar-override";
import { FilesTopBarAccessory } from "./pages/files/top-bar";

// The phone's navigation over the shared Stella UI, in place of the desktop's top bar (the phone
// build swaps `ui/shell/ShellTopBarFull` for this), laid out as packages/mobile's main layout:
// round glass buttons at the top (account at the start, chat settings at the end) around Stella's
// status pill or the tab's title, the icon-only bottom bar (Chat, Schedule, Apps, Files), the tab
// pages, the two drawers that wait behind the page (DrawerStage; PhoneRoot moves the page aside),
// and the full-screen page an opened Stella View shows in (ViewScreen.tsx).

/** packages/mobile's TOP_BAR_BAR_HEIGHT: the bar under the status bar; its 44 pt buttons sit on its bottom edge. */
export const PHONE_TOPBAR_H = 42;
const BUTTON = 44;
const EDGE = 10;
const BAR_ROW = 50;
const BAR_MAX_W = 480;
const BAR_FADE = 10;
const PILL_W = 62;
const PILL_H = 38;
const SHEET_RAISE = 40;
const TAPER_TAIL = 24;
/** The floating chevron that a drawer's button becomes: over the page's veil (PhoneRoot) and its chrome. */
const CHEVRON_RAISE = 64;

/** The bar's padding under its row, over the home indicator (the RN app's `bottomBarPadding`). */
export const barPad = (safeBottom: number) => Math.max(safeBottom - 6, 4);
/** What a page keeps free at its bottom for the bar. */
export const barBase = (i: PhoneInsets) => BAR_ROW + barPad(i.bottom);
/** useTabBottomInset: a tab page's free space at its bottom (the bar and 10 pt over it). */
export const tabBottomInset = (i: PhoneInsets) => barBase(i) + 10;

const ViewBackButton = ({ id, label, onPress }: { id: string; label: string; onPress: () => void }) => <GlassCircle id={id} icon={glyph("chevron-left")} label={label} onPress={onPress} iconSize={20} />;

const TITLE_KEYS: Record<Exclude<PhoneTab, "chat">, string> = { schedule: "mobile.activityHub.tabs.schedule", apps: "mobile.nav.apps", files: "mobile.activityHub.tabs.files" };

function TopBar({ width, insets, tab, shown }: { width: number; insets: PhoneInsets; tab: PhoneTab; shown: PhoneDrawer }) {
  const c = useRn();
  const tr = useT();
  const lane = Math.max(0, width - 2 * (EDGE + BUTTON + 8));
  const live = shown !== null;
  const o = useTopBarOverride(tab);
  return (
    <box id="phone-topbar" fixed absolute={{ left: 0, right: 0, top: 0 }} h={insets.top + PHONE_TOPBAR_H} raise={SHEET_RAISE + 1} opacity={live ? 0 : 1} motion={{ dur: live ? 0.12 : 0.3, bounce: 0 }} inert={live}>
      <row absolute={{ left: EDGE + BUTTON + 8, right: EDGE + BUTTON + 8, bottom: 0 }} h={BUTTON} center>
        {tab === "chat" ? (
          <StatusPill maxWidth={lane} />
        ) : (
          <text role="heading" {...TEXT.topTitle} color={c.text} maxLines={1}>
            {o.title ?? tr(TITLE_KEYS[tab])}
          </text>
        )}
      </row>
      <box absolute={{ left: EDGE, bottom: 0 }}>
        {o.back ? (
          <GlassCircle id="phone-topbar-back" icon={glyph("chevron-left")} iconSize={20} label={o.back.label} onPress={o.back.onPress} />
        ) : (
          <GlassCircle id="phone-account-button" icon={glyph("person-circle")} iconSize={20} label={tr("mobile.nav.account")} onPress={() => phoneNav.openDrawer("account")} />
        )}
      </box>
      {tab === "files" ? (
        <row absolute={{ right: EDGE, bottom: 0 }} h={BUTTON} align="center">
          <FilesTopBarAccessory />
        </row>
      ) : null}
      {tab === "chat" ? (
        <box absolute={{ right: EDGE, bottom: 0 }}>
          <GlassCircle id="phone-chat-settings-button" icon={glyph("gear")} iconSize={20} label={tr("mobile.nav.chatSettingsLabel")} onPress={() => phoneNav.openDrawer("chat-settings")} />
        </box>
      ) : null}
    </box>
  );
}

/** The app's background behind the top bar, solid through the status bar and the buttons' middle
 * and fading out just under them, so a message scrolled up passes beneath Stella's status instead of
 * through it (packages/mobile ChatPane's top taper). */
function TopTaper({ insets, tab, st }: { insets: PhoneInsets; tab: PhoneTab; st: Stage }) {
  const bg = useTokens().c.background;
  const h = insets.top + PHONE_TOPBAR_H + TAPER_TAIL;
  const solid = (insets.top + PHONE_TOPBAR_H * 0.85) / h;
  return <box id="phone-top-taper" fixed absolute={{ left: 0, top: 0, right: 0 }} h={h} {...stageFollow(st, 0, h)} raise={SHEET_RAISE - 1} hidden={tab !== "chat"} inert gradient={{ angle: 180, stops: [[0, bg], [solid, bg], [1, alpha(bg, 0)]] }} />;
}

function BottomBar({ insets, tab, st }: { insets: PhoneInsets; tab: PhoneTab; st: Stage }) {
  const t = useTokens();
  const tr = useT();
  const pad = barPad(insets.bottom);
  const bg = t.c.background;
  const pill = alpha(t.c.textStrong, t.dark ? 0.12 : 0.07);
  const labels: Record<PhoneTab, string> = { chat: tr("mobile.nav.chat"), schedule: tr("mobile.activityHub.tabs.schedule"), apps: tr("mobile.nav.apps"), files: tr("mobile.activityHub.tabs.files") };
  // The React Native app's bar: flush with the bottom edge over the app's own background,
  // which fades in over its top 10 points; no glass.
  return (
    <col id="phone-bottom-bar-dock" fixed absolute={{ left: 0, right: 0, bottom: 0 }} h={BAR_ROW + pad} pb={pad} {...stageFollow(st, st.size.h - (BAR_ROW + pad), BAR_ROW + pad)} raise={SHEET_RAISE + 1} keyboard={{ fade: BAR_ROW + pad }} inert={insets.keyboard > 0}>
      <box absolute={{ left: 0, top: 0, right: 0, bottom: 0 }} gradient={{ angle: 180, stops: [[0, alpha(bg, 0)], [BAR_FADE / (BAR_ROW + pad), bg], [1, bg]] }} />
      <row id="phone-bottom-bar" role="tablist" w="full" maxW={BAR_MAX_W} selfAlign="center" h={BAR_ROW} px={34} align="center" justify="center">
        {PHONE_TABS.map((id) => {
          const on = id === tab;
          return (
            <box key={id} grow={1} h="full" center>
              <box id={`phone-tab-${id}`} role="tab" selected={on} label={labels[id]} focusable w={PILL_W} h={PILL_H} center onPress={() => (on ? topBarOverride.reset(id) : phoneNav.selectTab(id))} pressFill={alpha(t.c.foreground, t.dark ? 0.08 : 0.05)}>
                {on ? <box absolute={{ left: 0, top: 0, right: 0, bottom: 0 }} radius={PILL_H / 2} fill={pill} /> : null}
                <Icon icon={tabIcon(id, on)} size={21} color={on ? t.c.textStrong : alpha(t.c.textWeak, t.dark ? 0.9 : 0.85)} />
              </box>
            </box>
          );
        })}
      </row>
    </col>
  );
}

/** The tab pages over the chat, each kept once visited (as the desktop's sidebar sections are), laid
 * out as packages/mobile's MainDetailSurface: under the top bar, 24 pt from the sides. */
function TabPages({ insets, tab, st }: { insets: PhoneInsets; tab: PhoneTab; st: Stage }) {
  const t = useTokens();
  const [visited, setVisited] = useState<ReadonlySet<PhoneTab>>(() => new Set([tab]));
  useEffect(() => setVisited((v) => (v.has(tab) ? v : new Set([...v, tab]))), [tab]);
  const top = insets.top + PHONE_TOPBAR_H + 4;
  const bottom = tabBottomInset(insets);
  const base = stageFollow(st, 0, st.size.h);
  const follow = { ...base, stage: { ...base.stage, radius: held([[0, 0], [0.12, DRAWER_RADIUS]]) } };
  const page = (id: Exclude<PhoneTab, "chat">, body: ReactNode) =>
    visited.has(id) ? (
      <RetainedSurface id={`phone-page-${id}`} active={tab === id} layered>
        <col w="full" h="full" pt={top} pl={insets.left} pr={insets.right}>
          {body}
        </col>
      </RetainedSurface>
    ) : null;
  return (
    <col id="phone-tab-pages" fixed inset={0} {...follow} clip={st.live ? 0 : undefined} raise={SHEET_RAISE} fill={t.c.background} hidden={tab === "chat"}>
      <TopInsetContext.Provider value={top}>
        {page("schedule", <SchedulePage active={tab === "schedule"} bottom={bottom} />)}
        {page("apps", <AppsPage active={tab === "apps"} bottom={bottom} />)}
        {page("files", <FilesPage active={tab === "files"} bottom={bottom} />)}
      </TopInsetContext.Provider>
    </col>
  );
}

/** packages/mobile's PANEL_BLUR (intensity 34), in points: the drawer sharpens out of it as it opens. */
const PANEL_BLUR = 9;

/**
 * One drawer, behind the page: it fades in, sharpens out of a blur and grows from 0.95 as the
 * page moves aside (DrawerPanel). A finger dragging it toward the page pulls it shut.
 */
function DrawerPanel({ side, width, insets, children }: { side: Exclude<PhoneDrawer, null>; width: number; insets: PhoneInsets; children: ReactNode }) {
  const { drawer, shown } = usePhoneNav();
  const size = useWindowSize();
  const travel = drawerTravel(size.w);
  const ours = shown === side;
  const open = drawer === side;
  const sign = signOf(side);
  const tracks = useMemo(() => panelTracks(sign, travel), [sign, travel]);
  const t = useTokens();
  const bg = t.c.background;
  return (
    <col
      id={`phone-drawer-${sideOf(side)}`}
      role="dialog"
      absolute={sideOf(side) === "start" ? { left: 0, top: 0, bottom: 0 } : { right: 0, top: 0, bottom: 0 }}
      w={width}
      stage={tracks}
      hidden={!ours}
      inert={!open}
      // RN's close pan, alongside the drawer's own scroll: a finger moving toward the page (away
      // from the far edge) pulls it shut, ahead of the scroll view under it.
      edgeDrag={open ? (sideOf(side) === "start" ? { right: size.w } : { left: size.w }) : undefined}
      stageDrag="close"
      onEdgeDrag={open ? noop : undefined}
    >
      <col w="full" h="full" pl={sideOf(side) === "start" ? insets.left : 0} pr={sideOf(side) === "end" ? insets.right : 0}>
        {children}
      </col>
      {/* packages/mobile's SidebarTopFade: the background solid under the status bar, fading out 14 pt below it. */}
      <box absolute={{ left: 0, top: 0, right: 0 }} h={insets.top + 14} inert gradient={{ angle: 180, stops: [[0, bg], [insets.top / (insets.top + 14), bg], [1, alpha(bg, 0)]] }} />
      {/* DrawerPanel's focus blur: the drawer starts blurred (BlurView, the theme's tint) and sharpens as it opens, gone from 97 %. */}
      {ours ? <box id={`phone-drawer-${sideOf(side)}-blur`} absolute={{ left: 0, top: 0, right: 0, bottom: 0 }} backdropBlur={PANEL_BLUR} fill={blurTint(t.dark)} stage={PANEL_FOCUS} inert /> : null}
    </col>
  );
}

const noop = () => {};
const PANEL_FOCUS: StageTracks = { opacity: held([[0, 1], [0.9, 0]]), hideAbove: 0.97 };
/** expo-blur's light and dark tints at the drawer's intensities: a thin wash of the material over the blur. */
const blurTint = (dark: boolean) => (dark ? "rgba(18,18,20,0.22)" : "rgba(255,255,255,0.28)");

/**
 * The drawer's button, handed off from the top bar as the drawer opens (DrawerStage's
 * FloatingChevron): it rides with the page while it rises to the drawer's title row, and its glyph
 * turns from the account or settings icon into the chevron that closes the drawer.
 */
function FloatingChevron({ side, insets }: { side: Exclude<PhoneDrawer, null>; insets: PhoneInsets }) {
  const t = useTokens();
  const tr = useT();
  const { drawer, shown } = usePhoneNav();
  const size = useWindowSize();
  const travel = drawerTravel(size.w);
  const ours = shown === side;
  const open = drawer === side;
  const sign = signOf(side);
  const left = sideOf(side) === "start" ? EDGE : size.w - EDGE - BUTTON;
  const top = insets.top + PHONE_TOPBAR_H - BUTTON;
  const cx = left + BUTTON / 2;
  const cy = top + BUTTON / 2;
  const openCenterY = insets.top + BRAND_TOP + BRAND_ROW / 2;
  // At progress v the page's scale is s = 1 - (1 - 0.9) v; the button rides the page's slide and
  // shrink about the window's centre, and rises to the drawer's title row: both linear in v.
  const settle = openCenterY - cy - (cy - size.h / 2) * (DRAWER_SCALE - 1);
  const k = DRAWER_SCALE - 1;
  const ride: StageTracks = { x: [[0, 0], [1, (cx - size.w / 2) * k + sign * travel]], y: [[0, 0], [1, (cy - size.h / 2) * k + settle]] };
  const rest = side === "account" ? glyph("person-circle") : glyph("gear");
  const turn = (sign * Math.PI) / 2;
  return (
    <box
      id={`phone-drawer-${sideOf(side)}-chevron`}
      absolute={{ left, top }}
      // Fixed, over the page's veil and its chrome (fixed too), which it rides with.
      fixed
      raise={CHEVRON_RAISE}
      stage={ride}
      hidden={!ours}
      inert={!open}
    >
      <GlassCircle id={`phone-drawer-${sideOf(side)}-chevron-button`} label={open ? tr("mobile.common.back") : side === "account" ? tr("mobile.nav.account") : tr("mobile.nav.chatSettingsLabel")} onPress={() => phoneNav.closeDrawer()}>
        <box absolute={{ left: 0, top: 0, right: 0, bottom: 0 }} center stage={{ rotate: held([[0, turn], [1, 0]]), opacity: held([[0.05, 0], [0.4, 1]]) }}>
          <Icon icon={glyph(sideOf(side) === "start" ? "chevron-left" : "chevron-right")} size={20} color={t.c.textStrong} />
        </box>
        <box absolute={{ left: 0, top: 0, right: 0, bottom: 0 }} center stage={{ rotate: held([[0, 0], [1, -turn]]), opacity: held([[0, 1], [0.3, 0]]) }}>
          <Icon icon={rest} size={20} color={t.c.textStrong} />
        </box>
      </GlassCircle>
    </box>
  );
}

/** Both drawers and their chevrons, rendered into PhoneRoot's drawer host behind the page. */
function Drawers({ insets }: { insets: PhoneInsets }) {
  const size = useWindowSize();
  const width = drawerTravel(size.w);
  const { drawer, shown } = usePhoneNav();
  return (
    <>
      <DrawerPanel side="account" width={width} insets={insets}>
        <AccountPanel showing={shown === "account"} open={drawer === "account"} width={width} insets={insets} />
      </DrawerPanel>
      <DrawerPanel side="chat-settings" width={width} insets={insets}>
        <ChatSettingsPanel showing={shown === "chat-settings"} open={drawer === "chat-settings"} width={width} insets={insets} />
      </DrawerPanel>
      <FloatingChevron side="account" insets={insets} />
      <FloatingChevron side="chat-settings" insets={insets} />
    </>
  );
}

/** Paints over the page and its chrome (the bars, the tab pages) while a drawer is out (DrawerStage's veil). */
const VEIL_RAISE = 60;
const STRIP_VEIL = 0.9;
/** The page's blur with a drawer open, in points (packages/mobile's PAGE_BLUR intensity 30). */
const PAGE_BLUR = 8;

/** The page's veil: the app's background over the page as it moves aside, which a tap or a drag on closes the drawer from. Fixed, so it carries the page's transform itself. */
function StageVeil({ st }: { st: Stage }) {
  const t = useTokens();
  const bg = t.c.background;
  const page = useMemo(() => pageTracks(st.travel), [st.travel]);
  const blur = useMemo(() => ({ ...page, opacity: blurTrack() }), [page]);
  const veil = useMemo(() => ({ ...page, opacity: veilTrack(STRIP_VEIL) }), [page]);
  if (!st.live) return null;
  return (
    <>
    {/* packages/mobile's page blur (DrawerStage's AnimatedBlur under the veil, in the theme's
        tint): the page and its bars blurred as they move aside, deepening on drawerBlur's curve. */}
    <box id="phone-stage-blur" fixed inset={0} raise={VEIL_RAISE} stage={blur} backdropBlur={PAGE_BLUR} fill={blurTint(t.dark)} inert />
    <box
      id="phone-stage-veil"
      fixed
      inset={0}
      raise={VEIL_RAISE}
      stage={veil}
      fill={bg}
      onPress={st.drawer ? () => phoneNav.closeDrawer() : undefined}
      stageDrag="close"
      onDrag={st.drawer ? noop : undefined}
    />
    </>
  );
}

/** Replaces the desktop's `ShellTopBarFull` in the phone build. */
export const ShellTopBarFull = memo(function PhoneChrome(_props: { onSignIn?: () => void }) {
  const insets = usePhoneInsets();
  const { tab, shown } = usePhoneNav();
  const size = useWindowSize();
  const host = useDrawerHost();
  const st = useStage();
  const bg = useTokens().c.background;
  useEffect(() => setStageBackground(bg), [bg]);
  // A tab page is opaque over the chat: the chat isn't drawn under it.
  useLayoutEffect(() => setChatCovered(tab !== "chat"), [tab]);
  useLayoutEffect(() => setPhoneSafeTop(insets.top), [insets.top]);
  // The chat-settings drawer belongs to the chat; leaving it closes the drawer (RN's MainLayout).
  useEffect(() => {
    if (tab !== "chat" && phoneNav.get().drawer === "chat-settings") phoneNav.closeDrawer();
  }, [tab]);
  return (
    <>
      <TabPages insets={insets} tab={tab} st={st} />
      <TopTaper insets={insets} tab={tab} st={st} />
      <TopBar width={size.w} insets={insets} tab={tab} shown={shown} />
      <BottomBar insets={insets} tab={tab} st={st} />
      <StageVeil st={st} />
      <PhoneViewScreen width={size.w} insets={insets} raise={SHEET_RAISE + 2} BackButton={ViewBackButton} />
      {host ? elementPortal(<Drawers insets={insets} />, host, "phone-drawers") : null}
    </>
  );
});

