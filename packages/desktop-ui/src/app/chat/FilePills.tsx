import { fileDisplayName } from "@stella/contracts/file-display-name";
import { useState, type ReactNode } from "react";
import { ChevronDown } from "@/ui/icons";
import { DisplayTabIcon } from "@/features/workspace-display/icons";
import type { DisplayTabKind } from "@/features/workspace-display/types";
import { openDisplayPayloadTab } from "@/features/workspace-display/open-payload";
import { displayTabKindForPayload } from "@/features/workspace-display/payload-kind";
import {
  basenameOf,
  localFilePathForPayload,
} from "@/features/workspace-display/path-to-viewer";
import type { ConversationFileEntry } from "@/features/workspace-display/derive-conversation-files";
import { getDisplayPayloadTitle } from "@stella/contracts/desktop/display-payload";
import { OpenWithMenu } from "./OpenWithMenu";
import { translateNow, useT, useTPlural } from "@/shared/i18n";
import { useOpenConversationFile } from "@/features/cloud/use-cloud-drive-open";
import "./agent-activity-row.css";
import { contextMenu, fileMenu } from "@/platform/context-menu";

const PILL_CAP = 5;

const pillName = (entry: ConversationFileEntry): string =>
  entry.payload.kind === "canvas-html"
    ? getDisplayPayloadTitle(entry.payload)
    : fileDisplayName(basenameOf(entry.path));

/** One file pill: what sits under a message for each file it made. */
export const FilePillButton = ({
  kind,
  name,
  title,
  onOpen,
  localFilePath,
  children,
}: {
  kind: DisplayTabKind;
  name: string;
  title: string;
  onOpen: () => void;
  localFilePath?: string | null;
  children?: ReactNode;
}) => {
  return (
    <span
      className="agent-activity-files__pill"
      title={title}
      onClick={(event) => event.stopPropagation()}
      onContextMenu={contextMenu(
        localFilePath
          ? fileMenu(localFilePath, { open: onOpen })
          : () => [[{ label: translateNow("contextMenu.open"), run: onOpen }]],
      )}
    >
      <button
        type="button"
        className="agent-activity-files__pill-open"
        onClick={onOpen}
      >
        <span className="agent-activity-files__pill-icon" aria-hidden="true">
          <DisplayTabIcon kind={kind} size={14} />
        </span>
        <span className="agent-activity-files__pill-name">{name}</span>
      </button>
      {children}
    </span>
  );
};

const FilePillView = ({
  entry,
  onOpen,
  localFilePath,
}: {
  entry: ConversationFileEntry;
  onOpen: () => void;
  localFilePath?: string | null;
}) => {
  return (
    <FilePillButton
      kind={displayTabKindForPayload(entry.payload)}
      name={pillName(entry)}
      title={entry.path}
      onOpen={onOpen}
      localFilePath={localFilePath}
    >
      {localFilePath ? (
        <OpenWithMenu filePath={localFilePath} />
      ) : null}
    </FilePillButton>
  );
};

const CloudFilePill = ({ entry }: { entry: ConversationFileEntry }) => {
  const openFile = useOpenConversationFile();
  return <FilePillView entry={entry} onOpen={() => void openFile(entry)} />;
};

export const FilePill = ({ entry }: { entry: ConversationFileEntry }) =>
  entry.cloudDriveFile ? (
    <CloudFilePill entry={entry} />
  ) : (
    <FilePillView
      entry={entry}
      onOpen={() => openDisplayPayloadTab(entry.payload)}
      localFilePath={entry.payload.kind === "canvas-html" && entry.payload.driveBacked ? null : localFilePathForPayload(entry.payload)}
    />
  );

export const FilePills = ({
  files,
  variant = "row",
}: {
  files: ConversationFileEntry[];
  variant?: "row" | "bubble" | "standalone";
}) => {
  const t = useT();
  const tPlural = useTPlural();
  const [expanded, setExpanded] = useState(false);
  const total = files.length;
  const capped = total > PILL_CAP;
  const head = capped ? files.slice(0, PILL_CAP) : files;
  const rest = capped ? files.slice(PILL_CAP) : [];
  const hiddenCount = rest.length;
  if (total === 0) return null;

  return (
    <div
      className={`agent-activity-files${variant !== "row" ? ` agent-activity-files--${variant}` : ""}`}
    >
      <div className="agent-activity-files__pills">
        {head.map((entry) => (
          <FilePill key={entry.path} entry={entry} />
        ))}
      </div>
      {capped ? (
        <div
          className="agent-activity-files__overflow"
          data-expanded={expanded ? "true" : undefined}
          inert={expanded ? undefined : true}
        >
          <div className="agent-activity-files__overflow-clip">
            <div className="agent-activity-files__pills agent-activity-files__pills--overflow">
              {rest.map((entry) => (
                <FilePill key={entry.path} entry={entry} />
              ))}
            </div>
          </div>
        </div>
      ) : null}
      {capped ? (
        <button
          type="button"
          className="agent-activity-files__more"
          onClick={(event) => {
            event.stopPropagation();
            setExpanded((value) => !value);
          }}
          aria-expanded={expanded}
        >
          <ChevronDown
            size={13}
            strokeWidth={2}
            aria-hidden
            className="agent-activity-files__more-chevron"
            data-expanded={expanded ? "true" : undefined}
          />
          <span>
            {expanded
              ? t("app.chat.agentCompletion.showLess")
              : tPlural("app.chat.agentCompletion.showMore", hiddenCount)}
          </span>
        </button>
      ) : null}
    </div>
  );
};
