import { cloudWorldDriveName } from "@stella/contracts/cloud-world-paths";
import type { CanvasLink } from "@stella/contracts/canvas-links";
import { openConversationFile } from "@/features/cloud/use-cloud-drive-open";
import { openCloudAppPanel } from "@/features/cloud/open-cloud-app-panel";
import { openLocalPathOrExplain } from "@/features/chat/lib/open-local-path";
import { openWebLink } from "@/features/chat/lib/stella-web-links";
import { cloudDriveEntry } from "@/features/workspace-display/derive-conversation-files";

export const openCanvasLink = (link: CanvasLink): void => {
  switch (link.kind) {
    case "web":
      openWebLink(link.url);
      return;
    case "external":
      if (window.electronAPI?.system?.openExternal) {
        window.electronAPI.system.openExternal(link.url);
      } else {
        window.open(link.url, "_blank", "noopener,noreferrer");
      }
      return;
    case "drive":
      void openConversationFile(
        cloudDriveEntry(
          {
            path: link.path,
            name: cloudWorldDriveName(link.path),
            sizeBytes: 0,
            contentType: "application/octet-stream",
          },
          Date.now(),
        ),
      );
      return;
    case "device":
      openLocalPathOrExplain(link.path, { fromDocument: true });
      return;
    case "app":
      openCloudAppPanel({ appId: link.slug });
      return;
    case "fragment":
    case "blocked":
      return;
  }
};
