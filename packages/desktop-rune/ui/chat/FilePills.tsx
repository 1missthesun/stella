import { useState } from "react";
import { fileDisplayName } from "@stella/contracts/file-display-name";
import { getDisplayPayloadTitle } from "@stella/contracts/desktop/display-payload";
import { openDisplayPayloadTab } from "@/features/workspace-display/open-payload";
import { displayTabKindForPayload } from "@/features/workspace-display/payload-kind";
import { basenameOf, localFilePathForPayload } from "@/features/workspace-display/path-to-viewer";
import type { ConversationFileEntry } from "@/features/workspace-display/derive-conversation-files";
import { useOpenConversationFile } from "@/features/cloud/use-cloud-drive-open";
import { fileMenu } from "@/platform/context-menu";
import { contextMenu } from "./context-menu";
import { translateNow, useT, useTPlural } from "@/shared/i18n";
import { Icon, Icons, withStroke } from "../kit";
import { derive, fontSize, mix, radius, useTokens } from "../theme";
import { useChatTextColor } from "./chat-text";
import { OpenWithMenu } from "./OpenWithMenu";

const PILL_CAP = 5;

const pillName = (entry: ConversationFileEntry): string => (entry.payload.kind === "canvas-html" ? getDisplayPayloadTitle(entry.payload) : fileDisplayName(basenameOf(entry.path)));

const FilePillView = ({ entry, onOpen, localFilePath }: { entry: ConversationFileEntry; onOpen: () => void; localFilePath?: string | null }) => {
  const tokens = useTokens();
  const color = useChatTextColor(tokens.c.textStrong);
  const look = derive(tokens, `file-pill:${color}`, () => ({ fill: mix(color, 12, "transparent"), hover: mix(color, 18, "transparent") }));
  const kind = displayTabKindForPayload(entry.payload);
  return (
    <row
      title={entry.path}
      align="center"
      gap={2}
      maxW="full"
      minW={0}
      py={2}
      px={4}
      radius={radius.full}
      fill={look.fill}
      hoverFill={look.hover}
      onContextMenu={contextMenu(localFilePath ? fileMenu(localFilePath, { open: onOpen }) : () => [[{ label: translateNow("contextMenu.open"), run: onOpen }]])}
    >
      <row role="button" focusable align="center" gap={5} minW={0} maxW="full" pt={3} pb={3} pl={6} pr={2} radius={radius.full} focusRing={{ color: tokens.c.ring, width: 2, offset: 0 }} onPress={onOpen}>
        <box shrink={false} opacity={0.8}>
          <Icon icon={Icons.display[kind as keyof typeof Icons.display] ?? Icons.display.text} size={14} color={color} />
        </box>
        <text size={fontSize.base} weight={500} lineHeight={fontSize.base * 1.2} color={color} nowrap truncate>
          {pillName(entry)}
        </text>
      </row>
      {localFilePath ? <OpenWithMenu filePath={localFilePath} /> : null}
    </row>
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

const CONNECTOR_ELBOW = 10;

export const FilePills = ({ files, variant = "row" }: { files: ConversationFileEntry[]; variant?: "row" | "bubble" | "standalone" }) => {
  const t = useT();
  const tPlural = useTPlural();
  const tokens = useTokens();
  const [expanded, setExpanded] = useState(false);
  const total = files.length;
  const capped = total > PILL_CAP;
  const head = capped ? files.slice(0, PILL_CAP) : files;
  const rest = capped ? files.slice(PILL_CAP) : [];
  if (total === 0) return null;
  const spacing =
    variant === "bubble"
      ? { mt: 10, mb: 6 }
      : variant === "standalone"
        ? { mt: 4, mb: 2, ml: 14, pb: 10 }
        : { mt: 4, mb: 2, pl: 24 };
  return (
    <col gap={6} minW={0} layout={0.22} {...spacing}>
      {variant === "standalone" ? (
        <box absolute={{ left: -9, bottom: -2 }} w={14} h={18} border={tokens.c.borderStrong} borderSides={[0, 0, 1.5, 1.5]} corners={[0, 0, 0, CONNECTOR_ELBOW]} opacity={0.85} inert />
      ) : null}
      <row wrap gap={6} minW={0}>
        {head.map((entry) => (
          <FilePill key={entry.path} entry={entry} />
        ))}
      </row>
      {capped && expanded ? (
        <row wrap gap={6} minW={0} enter={{ opacity: 0, dur: 0.22, bounce: 0 }} exit={{ opacity: 0, dur: 0.22, bounce: 0 }}>
          {rest.map((entry) => (
            <FilePill key={entry.path} entry={entry} />
          ))}
        </row>
      ) : null}
      {capped ? (
        <row
          role="button"
          focusable
          expanded={expanded}
          selfAlign="start"
          align="center"
          gap={4}
          py={2}
          px={4}
          radius={6}
          hoverGroup
          focusRing={{ color: tokens.c.ring, width: 2, offset: 0 }}
          onPress={() => setExpanded((value) => !value)}
        >
          <box rotate={expanded ? 180 : 0} motion={{ dur: 0.2, bounce: 0 }}>
            <Icon icon={withStroke(Icons.stella.ChevronDown, 2)} size={13} color={tokens.c.textWeak} />
          </box>
          <text size={fontSize.xs} weight={500} color={tokens.c.textWeak} hoverColor={tokens.c.textStrong}>
            {expanded ? t("app.chat.agentCompletion.showLess") : tPlural("app.chat.agentCompletion.showMore", rest.length)}
          </text>
        </row>
      ) : null}
    </col>
  );
};
