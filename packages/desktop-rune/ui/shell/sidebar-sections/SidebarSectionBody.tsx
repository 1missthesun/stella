import type { ComponentType } from "react";
import { isDocumentTab, useActiveSidebarSection, useSidebarActiveTabId, useSidebarOpenTabs } from "@/features/workspace-display/sidebar-sections";
import { FileSidebarTabExistenceReconciler } from "@/shell/sidebar-sections/FileSidebarTabExistenceReconciler";
import { RetainedSurface } from "../../kit";
import { mounted, Nothing } from "../../app/mount";

type Located = ComponentType<{ location: string | null; active: boolean }>;
type Activated = ComponentType<{ active: boolean }>;

const AppsSection = mounted<object>(import.meta.glob("./AppsSection.tsx", { eager: true }), "AppsSection", Nothing);
const BrowserSection = mounted<object>(import.meta.glob("./BrowserSection.tsx", { eager: true }), "BrowserSection", Nothing);
const UpdatesSection = mounted<object>(import.meta.glob("./UpdatesSection.tsx", { eager: true }), "UpdatesSection", Nothing);
const EmailSection = mounted<{ active: boolean }>(import.meta.glob("./EmailSection.tsx", { eager: true }), "EmailSection", Nothing) as Activated;
const ScheduleSection = mounted<{ active: boolean }>(import.meta.glob("./ScheduleSection.tsx", { eager: true }), "ScheduleSection", Nothing) as Activated;
const FilesSection = mounted<{ location: string | null; active: boolean }>(import.meta.glob("./FilesSection.tsx", { eager: true }), "FilesSection", Nothing) as Located;
const CloudBrowserTakeoverSection = mounted<{ location: string | null; active: boolean }>(import.meta.glob("./CloudBrowserTakeoverSection.tsx", { eager: true }), "CloudBrowserTakeoverSection", Nothing) as Located;

const PER_ITEM_BODIES: Record<string, Located> = { files: FilesSection, takeover: CloudBrowserTakeoverSection };

/** desktop-ui's `SidebarSectionBody`: each section stays mounted on the stage, shown when its tab is. */
export function SidebarSectionBody() {
  const tabs = useSidebarOpenTabs();
  const activeTabId = useSidebarActiveTabId();
  const activeSection = useActiveSidebarSection();
  return (
    <>
      <FileSidebarTabExistenceReconciler />
      {tabs.map((tab) => {
        const Body = PER_ITEM_BODIES[tab.kind];
        if (!Body || isDocumentTab(tab)) return null;
        const active = tab.id === activeTabId;
        return (
          <RetainedSurface key={tab.id} id={`sidebar-section-${tab.id}`} active={active} layered>
            <Body location={tab.location} active={active} />
          </RetainedSurface>
        );
      })}
      <RetainedSurface id="sidebar-section-apps" active={activeSection === "apps"} layered>
        <AppsSection />
      </RetainedSurface>
      <RetainedSurface id="sidebar-section-browser" active={activeSection === "browser"} layered>
        <BrowserSection />
      </RetainedSurface>
      <RetainedSurface id="sidebar-section-updates" active={activeSection === "updates"} layered>
        <UpdatesSection />
      </RetainedSurface>
      <RetainedSurface id="sidebar-section-email" active={activeSection === "email"} layered>
        <EmailSection active={activeSection === "email"} />
      </RetainedSurface>
      <RetainedSurface id="sidebar-section-schedule" active={activeSection === "schedule"} layered>
        <ScheduleSection active={activeSection === "schedule"} />
      </RetainedSurface>
    </>
  );
}
