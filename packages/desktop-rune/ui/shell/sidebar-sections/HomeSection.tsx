import { WorkspaceSections } from "../workspace/WorkspaceSections";

/** desktop-ui's `ActivityOverview`: `.sidebar-search` holding the overview variant of the workspace sections. */
export function ActivityOverview({ onNavigate }: { onNavigate?: () => void } = {}) {
  return (
    <col id="sidebar-search" grow={1} minH={0}>
      <col id="sidebar-search-body" minH={0} px={8} pb={10}>
        <WorkspaceSections variant="overview" searchMode="quick" onNavigate={onNavigate} />
      </col>
    </col>
  );
}
