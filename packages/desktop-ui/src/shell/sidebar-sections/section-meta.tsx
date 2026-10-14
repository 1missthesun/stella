import { AppWindowMac, Clock, Download, Folder, Globe, House, Lock, Mail } from "@/ui/icons";
import type { IconComponent } from "@/ui/icons";
import type { SidebarSection } from "@/features/workspace-display/sidebar-sections";

export type SidebarSectionMeta = {
  label: string;
  Icon: IconComponent;
};

export const SIDEBAR_SECTION_META: Record<SidebarSection, SidebarSectionMeta> =
  {
    home: { label: "Home", Icon: House },
    files: { label: "Files", Icon: Folder },
    apps: { label: "Apps", Icon: AppWindowMac },
    browser: { label: "Browser", Icon: Globe },
    schedule: { label: "Schedule", Icon: Clock },
    updates: { label: "Updates", Icon: Download },
    email: { label: "Email", Icon: Mail },
    takeover: { label: "Sign in", Icon: Lock },
  };

export const HOME_LAUNCHER_SECTIONS: ReadonlyArray<
  Exclude<SidebarSection, "home" | "takeover">
> = ["files", "apps", "browser", "schedule", "email", "updates"];
