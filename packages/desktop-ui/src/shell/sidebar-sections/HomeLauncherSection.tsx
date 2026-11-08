import { sidebarSections } from "@/features/workspace-display/sidebar-sections";
import { useAppSourceState } from "@/features/app-source/app-source-store";
import { WorkList } from "./FilesSection";
import { HOME_LAUNCHER_SECTIONS, SIDEBAR_SECTION_META } from "./section-meta";
import { openTrashDisplayTab } from "@/shell/display/default-tabs";
import { Trash2 } from "@/ui/icons";
import "./home-launcher.css";

function LauncherOptions() {
  const fromSource = useAppSourceState() !== null;
  const sections = HOME_LAUNCHER_SECTIONS.filter(
    (section) => section !== "updates" || fromSource,
  );
  return (
    <div className="home-launcher">
      <ul className="home-launcher__list">
        {sections.map((section) => {
          const { label, Icon } = SIDEBAR_SECTION_META[section];
          return (
            <li key={section}>
              <button
                type="button"
                className="home-launcher__option"
                onClick={() => sidebarSections.selectSection(section)}
              >
                <span className="home-launcher__option-icon" aria-hidden="true">
                  <Icon size={20} strokeWidth={1.6} />
                </span>
                <span className="home-launcher__option-label">{label}</span>
              </button>
            </li>
          );
        })}
        <li>
          <button
            type="button"
            className="home-launcher__option"
            onClick={openTrashDisplayTab}
          >
            <span className="home-launcher__option-icon" aria-hidden="true">
              <Trash2 size={20} strokeWidth={1.6} />
            </span>
            <span className="home-launcher__option-label">Trash</span>
          </button>
        </li>
      </ul>
    </div>
  );
}

export function HomeLauncherSection() {
  return (
    <div className="work-section">
      <div className="work-section__body">
        <WorkList section="home" idleContent={<LauncherOptions />} />
      </div>
    </div>
  );
}
