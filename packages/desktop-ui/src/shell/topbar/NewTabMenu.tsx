import { useAppSourceState } from "@/features/app-source/app-source-store";
import { sidebarSections } from "@/features/workspace-display/sidebar-sections";
import { openTrashDisplayTab } from "@/shell/display/default-tabs";
import { WorkList } from "@/shell/sidebar-sections/FilesSection";
import {
  HOME_LAUNCHER_SECTIONS,
  SIDEBAR_SECTION_META,
} from "@/shell/sidebar-sections/section-meta";
import { Trash2, type IconComponent } from "@/ui/icons";
import "./new-tab-menu.css";

type Place = {
  key: string;
  label: string;
  Icon: IconComponent;
  open: () => void;
};

function PlaceTiles({ onPick }: { onPick: () => void }) {
  const fromSource = useAppSourceState() !== null;
  const places: Place[] = [
    ...HOME_LAUNCHER_SECTIONS.filter(
      (section) => section !== "updates" || fromSource,
    ).map((section) => ({
      key: section,
      label: SIDEBAR_SECTION_META[section].label,
      Icon: SIDEBAR_SECTION_META[section].Icon,
      open: () => sidebarSections.openSectionTab(section),
    })),
    { key: "trash", label: "Trash", Icon: Trash2, open: openTrashDisplayTab },
  ];
  return (
    <ul className="new-tab-menu__places">
      {places.map(({ key, label, Icon, open }) => (
        <li key={key}>
          <button
            type="button"
            className="new-tab-menu__place"
            onClick={() => {
              onPick();
              open();
            }}
          >
            <span className="new-tab-menu__place-icon" aria-hidden="true">
              <Icon size={18} strokeWidth={1.6} />
            </span>
            <span className="new-tab-menu__place-label">{label}</span>
          </button>
        </li>
      ))}
    </ul>
  );
}

/**
 * The top bar's + menu: search everything, or open a place as its own tab.
 * Picking a search result or a place closes the menu.
 */
export function NewTabMenu({ onPick }: { onPick: () => void }) {
  return (
    <div
      className="new-tab-menu"
      onClickCapture={(event) => {
        const target = event.target as HTMLElement;
        if (target.closest(".files-list__items button, .files-list__items a")) {
          onPick();
        }
      }}
    >
      <WorkList
        section="home"
        embedded
        idleContent={<PlaceTiles onPick={onPick} />}
      />
    </div>
  );
}
