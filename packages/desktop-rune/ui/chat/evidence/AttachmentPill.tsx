import type { EvidenceCard } from "@stella/contracts/chat-evidence";
import { fileDisplayName } from "@stella/contracts/file-display-name";
import { openLocalPathOrExplain } from "@/features/chat/lib/open-local-path";
import { fileMenu } from "@/platform/context-menu";
import { contextMenu } from "../context-menu";
import { Icon, Icons, type IconData } from "../../kit";
import { APP_TRACKING } from "../../kit/compat";
import { derive, fontSize, mix, radius, useTokens } from "../../theme";
import { useChatTextColor } from "../chat-text";

const glyphFor = (card: EvidenceCard): IconData => {
  if (card.kind === "table") return Icons.stella.FileSpreadsheet;
  if (card.kind === "page") return Icons.stella.Globe;
  if (card.kind === "bundle") return card.sourcePaths[0]?.toLowerCase().endsWith(".zip") ? Icons.stella.Archive : Icons.stella.Folder;
  return Icons.stella.FileText;
};

export const AttachmentPill = ({ card }: { card: EvidenceCard }) => {
  const tokens = useTokens();
  const color = useChatTextColor(tokens.c.textStrong);
  const look = derive(tokens, `attachment-pill:${color}`, () => ({ fill: mix(color, 12, "transparent"), hover: mix(color, 18, "transparent") }));
  const open = () => {
    const target = card.sourcePaths[0];
    if (target) openLocalPathOrExplain(target);
  };
  return (
    <row
      role="button"
      focusable
      title={card.sourcePaths.join(", ")}
      align="center"
      gap={6}
      maxW="full"
      minW={0}
      pt={4}
      pb={4}
      pl={8}
      pr={10}
      radius={radius.full}
      fill={look.fill}
      hoverFill={look.hover}
      cursor="pointer"
      focusRing={{ color: tokens.c.ring, width: 2, offset: 0 }}
      onPress={open}
      onContextMenu={contextMenu(async () => {
        const target = card.sourcePaths[0];
        return target ? await fileMenu(target, { open })() : null;
      })}
    >
      <box shrink={false} opacity={0.8}>
        <Icon icon={glyphFor(card)} size={13} color={color} />
      </box>
      <text size={fontSize.base} weight={400} tracking={APP_TRACKING} lineHeight={fontSize.base * 1.4} color={color} nowrap truncate>
        {card.sourcePaths[0] ? fileDisplayName(card.sourcePaths[0]) : card.title}
      </text>
    </row>
  );
};
