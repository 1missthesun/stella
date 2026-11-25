import { useCallback, useEffect, useState } from "react";
import type { DisplayFolderListing } from "@stella/contracts/desktop/ipc-contract";
import { useT } from "@/shared/i18n";
import { kindForPath } from "@/features/workspace-display/path-to-viewer";
import { openLocalPathOrExplain } from "@/features/chat/lib/open-local-path";
import { DisplayTabIcon } from "../../features/workspace-display/icons";
import { EmptyState, Icon, Icons } from "../../kit";
import { look, mixOklch, useTokens } from "../../theme";
import { PreviewProblem } from "./preview-states";

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

const nameOf = (folderPath: string): string => folderPath.split(/[\\/]/).filter(Boolean).pop() ?? folderPath;

type LoadState = { status: "loading" } | { status: "ready"; listing: DisplayFolderListing } | { status: "failed"; error: string };

type FolderEntry = DisplayFolderListing["entries"][number];

function Subtitle({ children }: { children: string }) {
  const t = useTokens();
  return (
    <text {...look(12, 400, { lh: 1.4 })} pt={2} color={t.c.textWeak} nowrap truncate>
      {children}
    </text>
  );
}

function FolderRow({ entry, onOpen }: { entry: FolderEntry; onOpen: (entry: FolderEntry) => void }) {
  const t = useTokens();
  return (
    <row role="button" label={entry.name} title={entry.path} focusable align="center" gap={10} w="full" px={8} py={9} radius={8} hover={mixOklch(t.c.foreground, 5, "transparent")} focusRing={{ width: 2, offset: 0, color: t.c.ring, radius: 8 }} onPress={() => onOpen(entry)}>
      <row shrink={false}>
        {entry.kind === "directory" ? <Icon icon={Icons.stella.Folder} size={18} color={t.c.textWeak} /> : <DisplayTabIcon kind={kindForPath(entry.path) ?? "download"} size={18} color={t.c.textWeak} />}
      </row>
      <text {...look(12, 400)} grow={1} minW={0} color={t.c.textStrong} nowrap truncate>
        {entry.name}
      </text>
      <text {...look(11, 400)} shrink={false} features="'tnum' 1" color={t.c.textWeak}>
        {entry.kind === "directory" ? "" : formatSize(entry.sizeBytes)}
      </text>
    </row>
  );
}

/** desktop-ui's `.folder-tab`: a folder's listing, opening subfolders in place and files in their viewer. */
export const FolderTabContent = ({ folderPath }: { folderPath: string }) => {
  const t = useT();
  const tk = useTokens();
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
        setState({ status: "failed", error: message.replace(/^Error invoking remote method '[^']+': (Error: )?/u, "") });
      });
    return () => {
      cancelled = true;
    };
  }, [current, attempt, t]);

  const openEntry = useCallback((entry: FolderEntry) => {
    if (entry.kind === "directory") {
      setTrail((previous) => [...previous, entry.path]);
      return;
    }
    openLocalPathOrExplain(entry.path);
  }, []);

  const goUp = useCallback(() => {
    setTrail((previous) => (previous.length > 1 ? previous.slice(0, -1) : previous));
  }, []);

  const header = (
    <row id="folder-tab-header" shrink={false} align="center" gap={10} minW={0}>
      {trail.length > 1 ? (
        <box id="folder-tab-back" role="button" label={t("shell.display.folder.back")} title={t("shell.display.folder.back")} focusable w={28} h={28} shrink={false} radius={8} align="center" justify="center" hover={mixOklch(tk.c.foreground, 6, "transparent")} hoverColor={tk.c.textStrong} focusRing={{ width: 2, offset: 0, color: tk.c.ring, radius: 8 }} onPress={goUp}>
          <Icon icon={Icons.stella.ChevronLeft} size={16} color={tk.c.textWeak} />
        </box>
      ) : (
        <row shrink={false}>
          <Icon icon={Icons.stella.Folder} size={18} color={tk.c.textWeak} />
        </row>
      )}
      <col minW={0}>
        <text role="heading" {...look(15, 600, { em: -0.01 })} color={tk.c.textStrong} nowrap truncate title={current}>
          {nameOf(current)}
        </text>
        <Subtitle>{state.status === "ready" && state.listing.deviceName ? t("shell.display.folder.onDevice", { device: state.listing.deviceName }) : current}</Subtitle>
      </col>
    </row>
  );

  const body =
    state.status === "failed" ? (
      <PreviewProblem title={t("shell.display.folder.failedTitle")} error={state.error} onRetry={() => setAttempt((value) => value + 1)} />
    ) : state.status === "loading" ? (
      <Subtitle>{t("common.loading")}</Subtitle>
    ) : (
      <>
        {state.listing.entries.length === 0 ? (
          <EmptyState motif="unavailable" size="compact" title={t("shell.display.folder.emptyTitle")} />
        ) : (
          <col role="list" shrink={false}>
            {state.listing.entries.map((entry) => (
              <FolderRow key={entry.path} entry={entry} onOpen={openEntry} />
            ))}
          </col>
        )}
        {state.listing.truncated ? <Subtitle>{t("shell.display.folder.truncated", { count: state.listing.entries.length })}</Subtitle> : null}
      </>
    );

  return (
    <col id="folder-tab" h="full" gap={14} pt={22} px={18} pb={28} scrollY>
      {header}
      {body}
    </col>
  );
};
