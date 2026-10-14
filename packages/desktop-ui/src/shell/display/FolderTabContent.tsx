import { useCallback, useEffect, useState } from "react";
import type { DisplayFolderListing } from "@stella/contracts/desktop/ipc-contract";
import { useT } from "@/shared/i18n";
import { EmptyState } from "@/ui/empty-state/EmptyState";
import { ChevronLeft, Folder } from "@/ui/icons";
import { DisplayTabIcon } from "@/features/workspace-display/icons";
import { kindForPath } from "@/features/workspace-display/path-to-viewer";
import { openLocalPathOrExplain } from "@/features/chat/lib/open-local-path";
import { PreviewProblem } from "./preview-states";
import "./folder-tab.css";

const formatSize = (bytes: number): string => {
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value >= 10 ? Math.round(value) : value.toFixed(1)} ${units[unit]}`;
};

const nameOf = (folderPath: string): string =>
  folderPath.split(/[\\/]/).filter(Boolean).pop() ?? folderPath;

type LoadState =
  | { status: "loading" }
  | { status: "ready"; listing: DisplayFolderListing }
  | { status: "failed"; error: string };

export const FolderTabContent = ({ folderPath }: { folderPath: string }) => {
  const t = useT();
  const [trail, setTrail] = useState<string[]>([folderPath]);
  const current = trail[trail.length - 1] ?? folderPath;
  const [state, setState] = useState<LoadState>({ status: "loading" });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    setTrail([folderPath]);
  }, [folderPath]);

  useEffect(() => {
    let cancelled = false;
    setState({ status: "loading" });
    const list = window.electronAPI?.display?.listFolder;
    if (!list) {
      setState({ status: "failed", error: t("shell.display.folder.failedBody") });
      return;
    }
    list(current)
      .then((listing) => {
        if (!cancelled) setState({ status: "ready", listing });
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        const message = error instanceof Error ? error.message : String(error);
        setState({
          status: "failed",
          error: message.replace(/^Error invoking remote method '[^']+': (Error: )?/u, ""),
        });
      });
    return () => {
      cancelled = true;
    };
  }, [current, attempt, t]);

  const openEntry = useCallback(
    (entry: DisplayFolderListing["entries"][number]) => {
      if (entry.kind === "directory") {
        setTrail((previous) => [...previous, entry.path]);
        return;
      }
      openLocalPathOrExplain(entry.path);
    },
    [],
  );

  const goUp = useCallback(() => {
    setTrail((previous) => (previous.length > 1 ? previous.slice(0, -1) : previous));
  }, []);

  const header = (
    <header className="folder-tab__header">
      {trail.length > 1 ? (
        <button
          type="button"
          className="folder-tab__back"
          onClick={goUp}
          aria-label={t("shell.display.folder.back")}
          title={t("shell.display.folder.back")}
        >
          <ChevronLeft size={16} />
        </button>
      ) : (
        <Folder size={18} className="folder-tab__glyph" />
      )}
      <div className="folder-tab__heading">
        <h3 className="folder-tab__title" title={current}>
          {nameOf(current)}
        </h3>
        <p className="folder-tab__subtitle">
          {state.status === "ready" && state.listing.deviceName
            ? t("shell.display.folder.onDevice", { device: state.listing.deviceName })
            : current}
        </p>
      </div>
    </header>
  );

  if (state.status === "failed") {
    return (
      <div className="folder-tab folder-tab--empty" data-display-tab="folder">
        {header}
        <PreviewProblem
          title={t("shell.display.folder.failedTitle")}
          error={state.error}
          onRetry={() => setAttempt((value) => value + 1)}
        />
      </div>
    );
  }

  if (state.status === "loading") {
    return (
      <div className="folder-tab" data-display-tab="folder">
        {header}
        <p className="folder-tab__subtitle">{t("common.loading")}</p>
      </div>
    );
  }

  const { entries, truncated } = state.listing;
  return (
    <div className="folder-tab" data-display-tab="folder">
      {header}
      {entries.length === 0 ? (
        <EmptyState
          motif="unavailable"
          size="compact"
          title={t("shell.display.folder.emptyTitle")}
        />
      ) : (
        <ul className="folder-tab__list">
          {entries.map((entry) => (
            <li key={entry.path}>
              <button
                type="button"
                className="folder-tab__row"
                onClick={() => openEntry(entry)}
                title={entry.path}
              >
                {entry.kind === "directory" ? (
                  <Folder size={18} className="folder-tab__row-icon" />
                ) : (
                  <span className="folder-tab__row-icon">
                    <DisplayTabIcon
                      kind={kindForPath(entry.path) ?? "download"}
                      size={18}
                    />
                  </span>
                )}
                <span className="folder-tab__row-name">{entry.name}</span>
                <span className="folder-tab__row-meta">
                  {entry.kind === "directory" ? "" : formatSize(entry.sizeBytes)}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
      {truncated && (
        <p className="folder-tab__subtitle">
          {t("shell.display.folder.truncated", { count: entries.length })}
        </p>
      )}
    </div>
  );
};
