import { useCallback, useMemo, useState } from "react";
import type { KeyboardEvent } from "react";
import {
  cloudWorldDriveName,
  driveLinkPath,
  isCloudWorkspacePath,
} from "@stella/contracts/cloud-world-paths";
import {
  openLocalPath,
  showOpenPathError,
} from "@/features/chat/lib/open-local-path";
import { useOpenConversationFile } from "@/features/cloud/use-cloud-drive-open";
import { cloudDriveEntry } from "@/features/workspace-display/derive-conversation-files";
import { basenameOf } from "@/features/workspace-display/path-to-viewer";
import { useT } from "@/shared/i18n";

type StellaFileLinkProps = {
  path?: unknown;
  label?: unknown;
  node?: unknown;
};

const CloudDriveFileLink = ({
  drivePath,
  display,
}: {
  drivePath: string;
  display: string;
}) => {
  const openFile = useOpenConversationFile();
  const entry = useMemo(
    () =>
      cloudDriveEntry(
        {
          path: drivePath,
          name: cloudWorldDriveName(drivePath),
          sizeBytes: 0,
          contentType: "application/octet-stream",
        },
        Date.now(),
      ),
    [drivePath],
  );
  const open = useCallback(() => {
    void openFile(entry);
  }, [entry, openFile]);
  return (
    <a
      role="button"
      tabIndex={0}
      className="markdown-stella-file"
      title={drivePath}
      onClick={open}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          open();
        }
      }}
    >
      {display}
    </a>
  );
};

export const StellaFileLink = ({ path, label }: StellaFileLinkProps) => {
  const filePath = typeof path === "string" ? path : "";
  const rawLabel = typeof label === "string" ? label.trim() : "";
  const drivePath = filePath ? driveLinkPath(filePath) : null;
  if (drivePath) {
    return (
      <CloudDriveFileLink
        drivePath={drivePath}
        display={rawLabel || cloudWorldDriveName(drivePath)}
      />
    );
  }
  return <LocalStellaFileLink filePath={filePath} rawLabel={rawLabel} />;
};

const LocalStellaFileLink = ({
  filePath,
  rawLabel,
}: {
  filePath: string;
  rawLabel: string;
}) => {
  const t = useT();
  const [failed, setFailed] = useState(false);
  const display = rawLabel || (filePath ? basenameOf(filePath) : "");
  const cloudOnly = filePath ? isCloudWorkspacePath(filePath) : false;

  const open = useCallback(() => {
    if (!filePath) return;
    setFailed(false);
    if (cloudOnly) {
      setFailed(true);
      showOpenPathError(t("app.chat.fileLink.cloudWorkspaceOnly"));
      return;
    }
    void openLocalPath(filePath).then((error) => {
      if (!error) return;
      setFailed(true);
      showOpenPathError(error);
    });
  }, [cloudOnly, filePath, t]);

  const handleKeyDown = useCallback(
    (event: KeyboardEvent<HTMLAnchorElement>) => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        open();
      }
    },
    [open],
  );

  if (!filePath || !display) {
    return <span>{display || null}</span>;
  }

  return (
    <a
      role="button"
      tabIndex={0}
      className="markdown-stella-file"
      data-failed={failed || undefined}
      title={
        failed
          ? cloudOnly
            ? t("app.chat.fileLink.cloudWorkspaceOnly")
            : t("app.chat.fileLink.openFailed", { filePath })
          : filePath
      }
      onClick={open}
      onKeyDown={handleKeyDown}
    >
      {display}
    </a>
  );
};
