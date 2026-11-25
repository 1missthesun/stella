import { sidebarSections } from "@/features/workspace-display/sidebar-sections";
import { LayoutList } from "@/ui/icons";
import { EmptyState } from "@/ui/empty-state/EmptyState";

export function UnavailableFile({
  name,
  message,
}: {
  name: string;
  message: string;
}) {
  return (
    <EmptyState
      motif="unavailable"
      title="File unavailable"
      detail={name}
      body={message}
      action={{
        label: "Browse files",
        icon: LayoutList,
        onClick: () => sidebarSections.openSectionTab("files"),
      }}
    />
  );
}
