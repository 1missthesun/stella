import type { ReactNode } from "react";
import { useAppSourceState } from "@/features/app-source/app-source-store";
import { sidebarSections } from "@/features/workspace-display/sidebar-sections";
import { openTrashDisplayTab } from "@/shell/display/default-tabs";
import { HOME_LAUNCHER_SECTIONS, SIDEBAR_SECTION_META } from "@/shell/sidebar-sections/section-meta";
import { useEmailUnseenCount } from "@/features/email/email-unseen";
import { useEmailFeature } from "@/features/email/email-feature";
import { Icons, type IconData } from "../../kit";
import { derive, fontSize, look, mixOklch, useTokens } from "../../theme";
import { GroupIcon, Panel } from "./chrome";
import { WorkList } from "../sidebar-sections/FilesSection";

const PLACE_ICON: Record<string, IconData> = {
  files: Icons.stella.Folder,
  apps: Icons.stella.AppWindowMac,
  browser: Icons.stella.Globe,
  schedule: Icons.stella.Clock,
  email: Icons.stella.Mail,
  updates: Icons.stella.Download,
  trash: Icons.stella.Trash2,
};

type Place = { key: string; label: string; open: () => void; count?: number };

function PlaceTiles({ onPick }: { onPick: () => void }) {
  const t = useTokens();
  const l = derive(t, "new-tab-menu", (t) => ({ hover: mixOklch(t.c.foreground, 6, "transparent"), disc: mixOklch(t.c.foreground, 7, "transparent") }));
  const fromSource = useAppSourceState() !== null;
  const emailUnseen = useEmailUnseenCount();
  const emailOn = useEmailFeature();
  const places: Place[] = [
    ...HOME_LAUNCHER_SECTIONS.filter((section) => (section !== "updates" || fromSource) && (section !== "email" || emailOn)).map((section) => ({
      key: section,
      label: SIDEBAR_SECTION_META[section].label,
      open: () => sidebarSections.openSectionTab(section),
      ...(section === "email" && emailUnseen > 0 ? { count: emailUnseen } : {}),
    })),
    { key: "trash", label: "Trash", open: openTrashDisplayTab },
  ];
  return (
    <box id="new-tab-menu-places" w="full" pad={8} columns={4} gap={2} rowGap={2}>
      {places.map(({ key, label, open, count }) => (
        <col
          key={key}
          id={`new-tab-menu-place-${key}`}
          role="button"
          label={label}
          focusable
          w="full"
          minW={0}
          pt={10}
          pb={9}
          px={2}
          gap={7}
          align="center"
          radius={10}
          hover={l.hover}
          focusRing={{ width: 2, offset: 0, color: t.c.ring, radius: 10 }}
          motion={{ dur: 0.12 }}
          onPress={() => {
            onPick();
            open();
          }}
        >
          <box w={38} h={38} radius={19} center fill={l.disc}>
            <GroupIcon icon={PLACE_ICON[key] ?? Icons.stella.Folder} size={18} strokeWidth={1.6} color={t.c.textBase} />
          </box>
          <text {...look(fontSize.xs, 400)} color={t.c.textBase} nowrap truncate maxW="100%">{label}</text>
          {count ? (
            <box absolute={{ top: 4, right: 0 }} mr={0} minW={16} h={16} px={4} radius={999} center fill={t.c.primary} x={-0} label={`${count} new`}>
              <text size={10} weight={500} lineHeight={16} color={t.c.primaryForeground}>{count > 99 ? "99+" : String(count)}</text>
            </box>
          ) : null}
        </col>
      ))}
    </box>
  );
}

/** The + button and desktop-ui's `NewTabMenu`: search everything, or open a place. */
export function NewTabMenu({ open, onOpenChange, anchorFill, emailDot, dot }: { open: boolean; onOpenChange: (open: boolean) => void; anchorFill: { newHover: string; newOpen: string; strong: string; rest: string }; emailDot: boolean; dot: (key: string) => ReactNode }) {
  const t = useTokens();
  return (
    <>
      <box
        id="topbar-tabs-new"
        role="button"
        label="Open"
        title="Open (⌘T)"
        titleSide="bottom"
        focusable
        noWindowDrag
        w={26}
        h={26}
        radius={13}
        center
        shrink={false}
        fill={open ? anchorFill.newOpen : undefined}
        hover={open ? anchorFill.newOpen : anchorFill.newHover}
        hoverGroup
        focusRing={{ width: 2, offset: 0, color: t.c.ring, radius: 13 }}
        onPress={() => onOpenChange(!open)}
      >
        <box>
          <GroupIcon icon={Icons.stella.Plus} size={18} strokeWidth={1.5} color={open ? anchorFill.strong : anchorFill.rest} hoverColor={anchorFill.strong} />
          {emailDot ? dot("email") : null}
        </box>
      </box>
      <Panel id="new-tab-menu-popover" anchor="topbar-tabs-new" open={open} onClose={() => onOpenChange(false)} side="bottom" align="start" w={Math.min(360, window.innerWidth - 24)} label="Open">
        <col id="new-tab-menu" w="full" maxH={Math.min(480, window.innerHeight - 96)}>
          <WorkList section="home" embedded onPick={() => onOpenChange(false)} idleContent={<PlaceTiles onPick={() => onOpenChange(false)} />} />
        </col>
      </Panel>
    </>
  );
}
