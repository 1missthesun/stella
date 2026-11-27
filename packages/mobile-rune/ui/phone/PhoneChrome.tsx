import { memo, useCallback, useEffect, useState, type ReactNode } from "react";
import { openSignOutDialog } from "@/global/auth/SignOutDialog";
import { useT } from "@/shared/i18n";
import { Icon, Icons, RetainedSurface, type IconData } from "../../../desktop-rune/ui/kit";
import { lazyScreen, useLazyReady } from "../../../desktop-rune/ui/kit/lazy";
import { alpha, look, useTokens } from "../../../desktop-rune/ui/theme";
import { AdaptiveGlass, chromeGlass, GlassSheen, useGlassBackdrop } from "../../../desktop-rune/ui/shell/glass";
import { ShellTopBarActivity } from "../../../desktop-rune/ui/shell/ShellTopBarActivity";
import { TopInsetContext } from "../../../desktop-rune/ui/shell/top-inset";
import { SettingsPanel } from "../../../desktop-rune/ui/settings/SettingsPanel";
import { AppsSection } from "../../../desktop-rune/ui/shell/sidebar-sections/AppsSection";
import { FilesSection } from "../../../desktop-rune/ui/shell/sidebar-sections/FilesSection";
import { ScheduleSection } from "../../../desktop-rune/ui/shell/sidebar-sections/ScheduleSection";
import { AiTab } from "../../../desktop-rune/ui/settings/tabs/AiTab";
import { usePhoneInsets, type PhoneInsets } from "./insets";
import { PHONE_TABS, phoneNav, usePhoneNav, type PhoneTab } from "./nav";
import { tabIcon } from "./icons";
import { PhoneViewScreen } from "./ViewScreen";

// The phone's navigation over the shared Stella UI, in place of the desktop's top bar (the phone
// build swaps `ui/shell/ShellTopBarFull` for this): round glass buttons at the top (account at
// the start, chat settings at the end) around Stella's activity, the bottom bar's tabs (Chat,
// Schedule, Apps, Files) as a floating Liquid Glass capsule, the tab pages, the two drawers, and
// the full-screen page an opened Stella View shows in (ViewScreen.tsx).

/** packages/mobile's top bar: 44pt round buttons, 10pt from the edges. */
export const PHONE_TOPBAR_H = 52;
const BUTTON = 44;
const EDGE = 10;
const BAR_ROW = 50;
const BAR_MAX_W = 480;
const BAR_FADE = 10;
const PILL_W = 62;
const PILL_H = 38;
const SHEET_RAISE = 40;

/** The bottom bar's capsule floats this far above the window bottom (packages/mobile `bottomBarPadding`). */
/** The bar's padding under its row, over the home indicator (the RN app's `bottomBarPadding`). */
export const barPad = (safeBottom: number) => Math.max(safeBottom - 6, 4);
/** What a page keeps free at its bottom for the bar. */
export const barSpace = (i: PhoneInsets) => (i.keyboard > 0 ? i.keyboard : BAR_ROW + barPad(i.bottom));

/** packages/mobile's drawer travel: three quarters of the window, 320–400pt. */
const drawerWidth = (w: number) => Math.round(Math.max(Math.min(w * 0.75, 320), Math.min(w * 0.6, 400)));

const SettingsScreen = lazyScreen(() => import("../../../desktop-rune/ui/settings/SettingsView"), (m) => m.SettingsScreen);

function GlassButton({ id, icon, label, onPress, iconSize = 19 }: { id: string; icon: IconData; label: string; onPress: () => void; iconSize?: number }) {
  const t = useTokens();
  const m = chromeGlass(t).controls;
  return (
    <AdaptiveGlass>
      <box
        id={id}
        role="button"
        label={label}
        focusable
        w={BUTTON}
        h={BUTTON}
        radius={BUTTON / 2}
        center
        fx={m.fx}
        fill={m.fill}
        border={m.border}
        onBackdrop={useGlassBackdrop()}
        pressScale={0.92}
        onPress={onPress}
      >
        <GlassSheen radius={BUTTON / 2} />
        <Icon icon={icon} size={iconSize} color={t.c.foreground} />
      </box>
    </AdaptiveGlass>
  );
}

const ViewBackButton = ({ id, label, onPress }: { id: string; label: string; onPress: () => void }) => <GlassButton id={id} icon={Icons.stella.ChevronLeft} label={label} onPress={onPress} iconSize={21} />;

const TITLE_KEYS: Record<Exclude<PhoneTab, "chat">, string> = { schedule: "Schedule", apps: "Apps", files: "Files" };

function TopBar({ width, insets, tab, onWidth }: { width: number; insets: PhoneInsets; tab: PhoneTab; onWidth: (w: number) => void }) {
  const t = useTokens();
  const tr = useT();
  const middle = Math.max(0, width - 2 * (EDGE + BUTTON + 8));
  return (
    <row id="phone-topbar" fixed absolute={{ left: 0, right: 0, top: insets.top }} h={PHONE_TOPBAR_H} align="center" px={EDGE} gap={8} raise={SHEET_RAISE + 1} onLayout={(r) => onWidth(r.w)}>
      <GlassButton id="phone-account-button" icon={Icons.stella.User} label={tr("settings.title")} onPress={() => phoneNav.openDrawer("account")} />
      <row grow={1} minW={0} h="full" center>
        {tab === "chat" ? (
          <ShellTopBarActivity width={middle} />
        ) : (
          <text role="heading" {...look(17, 600)} color={t.c.foreground} maxLines={1}>
            {TITLE_KEYS[tab]}
          </text>
        )}
      </row>
      {tab === "chat" ? (
        <GlassButton id="phone-chat-settings-button" icon={Icons.stella.SlidersHorizontal} label="Chat settings" onPress={() => phoneNav.openDrawer("chat-settings")} />
      ) : (
        <box w={BUTTON} h={BUTTON} />
      )}
    </row>
  );
}

function BottomBar({ insets, tab }: { insets: PhoneInsets; tab: PhoneTab }) {
  const t = useTokens();
  const pad = barPad(insets.bottom);
  const bg = t.c.background;
  const pill = alpha(t.c.foreground, t.dark ? 0.12 : 0.07);
  // The React Native app's bar: flush with the bottom edge over the app's own background,
  // which fades in over its top 10 points; no glass.
  return (
    <col id="phone-bottom-bar-dock" fixed absolute={{ left: 0, right: 0, bottom: 0 }} h={BAR_ROW + pad} pb={pad} raise={SHEET_RAISE + 1} hidden={insets.keyboard > 0}>
      <box absolute={{ left: 0, top: 0, right: 0, bottom: 0 }} gradient={{ angle: 180, stops: [[0, alpha(bg, 0)], [BAR_FADE / (BAR_ROW + pad), bg], [1, bg]] }} />
      <row id="phone-bottom-bar" role="tablist" w="full" maxW={BAR_MAX_W} selfAlign="center" h={BAR_ROW} px={34} align="center" justify="center">
        {PHONE_TABS.map((id) => {
          const on = id === tab;
          return (
            <box key={id} grow={1} h="full" center>
              <box id={`phone-tab-${id}`} role="tab" selected={on} label={id} focusable w={PILL_W} h={PILL_H} center onPress={() => phoneNav.selectTab(id)} pressFill={alpha(t.c.foreground, t.dark ? 0.08 : 0.05)}>
                {on ? <box absolute={{ left: 0, top: 0, right: 0, bottom: 0 }} radius={PILL_H / 2} fill={pill} /> : null}
                <Icon icon={tabIcon(id, on)} size={21} color={on ? t.c.foreground : alpha(t.c.textMuted, t.dark ? 0.9 : 0.85)} />
              </box>
            </box>
          );
        })}
      </row>
    </col>
  );
}

/** The tab pages over the chat, each kept once visited (as the desktop's sidebar sections are). */
function TabPages({ insets, tab }: { insets: PhoneInsets; tab: PhoneTab }) {
  const t = useTokens();
  const [visited, setVisited] = useState<ReadonlySet<PhoneTab>>(() => new Set([tab]));
  useEffect(() => setVisited((v) => (v.has(tab) ? v : new Set([...v, tab]))), [tab]);
  const top = insets.top + PHONE_TOPBAR_H;
  return (
    <col id="phone-tab-pages" fixed inset={0} raise={SHEET_RAISE} fill={t.c.background} hidden={tab === "chat"} pb={barSpace(insets)}>
      <TopInsetContext.Provider value={top}>
        {visited.has("schedule") ? (
          <RetainedSurface id="phone-page-schedule" active={tab === "schedule"} layered>
            <ScheduleSection active={tab === "schedule"} />
          </RetainedSurface>
        ) : null}
        {visited.has("apps") ? (
          <RetainedSurface id="phone-page-apps" active={tab === "apps"} layered>
            <col w="full" h="full" pt={top}>
              <AppsSection />
            </col>
          </RetainedSurface>
        ) : null}
        {visited.has("files") ? (
          <RetainedSurface id="phone-page-files" active={tab === "files"} layered>
            <col w="full" h="full" pt={top}>
              <FilesSection />
            </col>
          </RetainedSurface>
        ) : null}
      </TopInsetContext.Provider>
    </col>
  );
}

function Drawer({ side, open, width, insets, children }: { side: "start" | "end"; open: boolean; width: number; insets: PhoneInsets; children: ReactNode }) {
  const t = useTokens();
  const [drag, setDrag] = useState(0);
  const sign = side === "start" ? -1 : 1;
  const close = useCallback(() => phoneNav.closeDrawer(), []);
  const shift = open ? Math.max(0, sign * drag) * sign : sign * (width + 24);
  return (
    <>
      <box id={`phone-drawer-${side}-scrim`} fixed inset={0} raise={SHEET_RAISE + 2} fill={t.c.scrim} opacity={open ? 1 : 0} motion={{ dur: 0.3, bounce: 0 }} inert={!open} onPress={close} />
      <col
        id={`phone-drawer-${side}`}
        role="dialog"
        fixed
        absolute={side === "start" ? { left: 0, top: 0, bottom: 0 } : { right: 0, top: 0, bottom: 0 }}
        w={width}
        raise={SHEET_RAISE + 3}
        fill={t.c.background}
        x={shift}
        motion={drag ? undefined : { dur: 0.38, bounce: 0.08 }}
        inert={!open}
        shadows={open ? t.shadow.sm : undefined}
        onDrag={(d) => {
          if (d.phase === "end") {
            if (sign * drag > width * 0.3) close();
            setDrag(0);
            return;
          }
          setDrag((v) => v + d.dx);
        }}
        pt={insets.top}
        pb={insets.bottom}
      >
        {children}
      </col>
    </>
  );
}

function AccountDrawer({ open, width, insets }: { open: boolean; width: number; insets: PhoneInsets }) {
  const [wanted, setWanted] = useState(open);
  if (open && !wanted) setWanted(true);
  const ready = useLazyReady(wanted, SettingsScreen);
  const signOut = useCallback(() => {
    phoneNav.closeDrawer();
    openSignOutDialog();
  }, []);
  return (
    <Drawer side="start" open={open} width={width} insets={insets}>
      {wanted && ready ? <SettingsScreen embedded onSignOut={signOut} /> : null}
    </Drawer>
  );
}

function ChatSettingsDrawer({ open, width, insets }: { open: boolean; width: number; insets: PhoneInsets }) {
  const [wanted, setWanted] = useState(open);
  if (open && !wanted) setWanted(true);
  return (
    <Drawer side="end" open={open} width={width} insets={insets}>
      {wanted ? (
        <SettingsPanel narrow>
          <AiTab />
        </SettingsPanel>
      ) : null}
    </Drawer>
  );
}

/** Replaces the desktop's `ShellTopBarFull` in the phone build. */
export const ShellTopBarFull = memo(function PhoneChrome(_props: { onSignIn?: () => void }) {
  const insets = usePhoneInsets();
  const { tab, drawer } = usePhoneNav();
  const [width, setWidth] = useState(__native.env.width);
  return (
    <>
      <TabPages insets={insets} tab={tab} />
      <TopBar width={width} insets={insets} tab={tab} onWidth={(w) => setWidth((old) => (Math.abs(old - w) < 0.5 ? old : w))} />
      <BottomBar insets={insets} tab={tab} />
      <PhoneViewScreen width={width} insets={insets} raise={SHEET_RAISE + 2} BackButton={ViewBackButton} />
      <AccountDrawer open={drawer === "account"} width={drawerWidth(width)} insets={insets} />
      <ChatSettingsDrawer open={drawer === "chat-settings"} width={drawerWidth(width)} insets={insets} />
    </>
  );
});

