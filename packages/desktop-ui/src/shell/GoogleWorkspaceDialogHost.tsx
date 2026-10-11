import { lazy, memo, Suspense } from "react";
import {
  googleWorkspaceDialog,
  useGoogleWorkspaceDialogOpen,
} from "@/shell/sidebar-sections/google-workspace-dialog-store";

const GoogleWorkspaceDialog = lazy(() =>
  import("@/shell/sidebar/GoogleWorkspaceDialog").then((module) => ({
    default: module.GoogleWorkspaceDialog,
  })),
);

export const GoogleWorkspaceDialogHost = memo(
  function GoogleWorkspaceDialogHost() {
    const open = useGoogleWorkspaceDialogOpen();
    if (!open) return null;
    return (
      <Suspense fallback={null}>
        <GoogleWorkspaceDialog
          open
          onOpenChange={(next) => googleWorkspaceDialog.setOpen(next)}
        />
      </Suspense>
    );
  },
);
