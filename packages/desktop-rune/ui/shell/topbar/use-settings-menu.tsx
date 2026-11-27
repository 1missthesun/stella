import { useRef, useState } from "react";
import { usePostOnboardingHint } from "@/global/onboarding/post-onboarding-hints";
import { platformCapabilities } from "@/platform/capabilities";
import { feedbackDialog } from "@/shell/sidebar-sections/feedback-dialog-store";
import { settingsDialog } from "@/shell/settings-dialog-store";
import { Icons, type IconData } from "../../kit";
import { lazyScreen, useLazyReady } from "../../kit/lazy";

const ConnectorsPopover = lazyScreen(() => import("../sidebar-sections/ConnectorsPopover"), (module) => module.ConnectorsPopover);
const ThemePicker = lazyScreen(() => import("../../replace/global/settings/ThemePicker"), (module) => module.ThemePicker);

const openPhoneDialog = () => {
  void import("@/router").then(({ router }) => {
    void router.navigate({ to: ".", search: (prev: Record<string, unknown>) => ({ ...prev, dialog: "connect" }) } as never);
  });
};

export type SettingsDestination = { id: string; label: string; icon: IconData; onSelect: () => void; hint?: boolean };

/** desktop-ui's `useSettingsMenu`: the settings destinations and the Theme / Connectors popovers they open at `anchor`. */
export function useSettingsMenu(anchor: string) {
  const connectHint = usePostOnboardingHint("connect");
  const [themeOpen, setThemeOpen] = useState(false);
  const themeReady = useLazyReady(themeOpen, ThemePicker);
  const [connectorsOpen, setConnectorsOpen] = useState(false);
  const connectorsReady = useLazyReady(connectorsOpen, ConnectorsPopover);
  const pendingPopoverRef = useRef<"theme" | "connectors" | null>(null);

  const applyPendingPopover = () => {
    const pendingPopover = pendingPopoverRef.current;
    if (!pendingPopover) return false;
    pendingPopoverRef.current = null;
    if (pendingPopover === "theme") setThemeOpen(true);
    else setConnectorsOpen(true);
    return true;
  };

  const destinations: SettingsDestination[] = [
    { id: "settings", label: "Settings", icon: Icons.stella.Settings, onSelect: () => settingsDialog.open() },
    { id: "theme", label: "Theme", icon: Icons.stella.Palette, onSelect: () => {
        pendingPopoverRef.current = "theme";
        void ThemePicker.preload();
      } },
    ...(platformCapabilities.phoneAccess
      ? [
          {
            id: "connect",
            label: "Stella on your phone",
            icon: Icons.stella.Smartphone,
            hint: connectHint.active,
            onSelect: () => {
              if (connectHint.active) connectHint.dismiss();
              openPhoneDialog();
            },
          },
        ]
      : []),
    { id: "connectors", label: "Connectors", icon: Icons.stella.Plug, onSelect: () => {
        pendingPopoverRef.current = "connectors";
        void ConnectorsPopover.preload();
      } },
    { id: "feedback", label: "Send feedback", icon: Icons.stella.CircleQuestionMark, onSelect: () => feedbackDialog.open() },
  ];

  const popovers = (
    <>
      {themeOpen && themeReady ? <ThemePicker hideTrigger open={themeOpen} onOpenChange={setThemeOpen} side="bottom" align="end" anchor={anchor} /> : null}
      {connectorsReady ? <ConnectorsPopover open={connectorsOpen} onOpenChange={setConnectorsOpen} side="bottom" align="end" anchor={anchor} /> : null}
    </>
  );

  return { destinations, connectHint, applyPendingPopover, popovers };
}
