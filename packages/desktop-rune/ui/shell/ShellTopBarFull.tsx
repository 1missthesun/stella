import { memo, useState, type ReactNode } from "react";
import { getPlatform } from "@/platform/electron/platform";
import { useAuthSessionState } from "@/global/auth/hooks/use-auth-session-state";
import { NotificationBell } from "../features/notifications/NotificationBell";
import { SHELL_TOPBAR_HEIGHT } from "./metrics";
import { ShellTopBarActivity } from "./ShellTopBarActivity";
import { ShellTopBarUpdatePill } from "./ShellTopBarUpdatePill";
import { GlobalExecutionTargetControl } from "./GlobalExecutionTargetControl";
import { GlobalModelsControl } from "./GlobalModelsControl";
import { ShellTopBarAccount } from "./sidebar/ShellTopBarAccount";
import { SettingsMenuButton } from "./SettingsMenuButton";
import { WindowControls } from "./WindowControls";
import { AdaptiveGlass, chromeGlass, GlassSheen, useGlassBackdrop } from "./glass";
import { useTokens } from "../theme";
import { ShellTopBarTabs } from "./topbar/ShellTopBarTabs";
import type { BoxProps } from "../../host/rune-jsx/props";

const COLUMN_GAP = 8;
const REACH_GAP = 12;
const MARK_TRIGGER = 22 + 12;
const CAPSULE_H = 32;
const CAPSULE_PAD = 3;

function CapsuleGlass({ children, ...props }: BoxProps & { children: ReactNode }) {
  const m = chromeGlass(useTokens()).controls;
  return (
    <row h={CAPSULE_H} radius={CAPSULE_H / 2} align="center" windowDrag {...props} fx={m.fx} fill={m.fill} border={m.border} onBackdrop={useGlassBackdrop()}>
      <GlassSheen radius={CAPSULE_H / 2} />
      {children}
    </row>
  );
}

function Capsule(props: BoxProps & { children: ReactNode }) {
  return (
    <AdaptiveGlass>
      <CapsuleGlass {...props} />
    </AdaptiveGlass>
  );
}

/** `grid-template-columns: minmax(0,1fr) minmax(40px, min(30rem, max(40px, 40vw - 200px))) minmax(max-content,1fr)`. */
function columns(width: number, rightContent: number) {
  const middle = Math.max(40, Math.min(480, Math.max(40, width * 0.4 - 200)));
  const free = Math.max(0, width - middle - COLUMN_GAP * 2);
  const right = Math.max(rightContent, free / 2);
  const left = Math.max(0, free - right);
  return { left, middle, right };
}

/** desktop-ui's `ShellTopBarFull` as floating Liquid Glass capsules over the chat, which runs under them to the window top: tabs on the left, Stella's activity in the middle, controls on the right. */
export const ShellTopBarFull = memo(function ShellTopBarFull({ onSignIn }: { onSignIn?: () => void }) {
  const platform = getPlatform();
  const isMac = platform === "darwin";
  const isWin = platform === "win32";
  const { hasConnectedAccount } = useAuthSessionState();
  const [width, setWidth] = useState(0);
  const [rightContent, setRightContent] = useState(0);
  const { left, middle, right } = columns(width, rightContent);
  const reach = Math.max(0, Math.floor((middle - MARK_TRIGGER) / 2 - REACH_GAP));
  const padLeft = isMac ? 84 : 12;

  return (
    <row
      id="shell-topbar-full"
      absolute={{ left: 0, top: 0, right: 0 }}
      h={SHELL_TOPBAR_HEIGHT}
      align="center"
      gap={COLUMN_GAP}
      raise={80}
      windowDrag
      onLayout={(r) => setWidth((w) => (Math.abs(w - r.w) < 0.5 ? w : r.w))}
    >
      <row id="shell-topbar-full-left" w={left + reach} mr={-reach} raise={1} h="full" align="center" gap={8} pl={padLeft} pr={12} minW={0} windowDrag>
        <Capsule px={CAPSULE_PAD} minW={0} shrink>
          <ShellTopBarTabs room={left + reach - padLeft - 12 - CAPSULE_PAD * 2} />
        </Capsule>
      </row>
      <ShellTopBarActivity width={middle} />
      <row id="shell-topbar-full-right" w={right} h="full" align="center" justify="end" pr={isWin ? 0 : 12} windowDrag>
        <row gap={8} align="center" h="full" onLayout={(r) => setRightContent((w) => (Math.abs(w - (r.w + (isWin ? 0 : 12))) < 0.5 ? w : r.w + (isWin ? 0 : 12)))}>
          <Capsule px={CAPSULE_PAD + 2} gap={4}>
            <ShellTopBarUpdatePill />
            <GlobalExecutionTargetControl />
            <NotificationBell />
            <GlobalModelsControl placement="topbar" />
            <ShellTopBarAccount onSignIn={onSignIn} />
            {!hasConnectedAccount ? <SettingsMenuButton /> : null}
          </Capsule>
          {isWin ? <WindowControls useWindowsIcons /> : null}
        </row>
      </row>
    </row>
  );
});
