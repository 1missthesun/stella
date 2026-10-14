import { WorkspaceSections } from "@/shell/workspace/WorkspaceSections";
import "./home-search.css";

export function ActivityOverview({
  onNavigate,
}: {
  onNavigate?: () => void;
} = {}) {
  return (
    <div className="sidebar-search">
      <div className="sidebar-search__body">
        <WorkspaceSections
          variant="overview"
          searchMode="quick"
          onNavigate={onNavigate}
        />
      </div>
    </div>
  );
}
