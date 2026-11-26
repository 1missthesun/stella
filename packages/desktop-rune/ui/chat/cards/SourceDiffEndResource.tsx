import { useMemo } from "react";
import type { DisplayPayload } from "@stella/contracts/desktop/display-payload";
import { openSourceDiffBatch } from "@/features/workspace-display/open-payload";
import { displayTabKindForPayload } from "@/features/workspace-display/payload-kind";
import { basenameOf } from "@/features/workspace-display/path-to-viewer";
import { useT, useTPlural } from "@/shared/i18n";
import { Icon, Icons } from "../../kit";
import { derive, fontSize, mix, mixOklch, radius, useTokens } from "../../theme";
import { panelSurface } from "../surfaces";

type SourceDiffPayload = Extract<DisplayPayload, { kind: "source-diff" }>;

export const SourceDiffEndResource = ({ batchId, payloads }: { batchId: string; payloads: DisplayPayload[] }) => {
  const t = useT();
  const tPlural = useTPlural();
  const tokens = useTokens();
  const diffs = useMemo(() => payloads.filter((entry): entry is SourceDiffPayload => entry.kind === "source-diff"), [payloads]);
  const createdAt = useMemo(() => {
    const latest = diffs.reduce((max, entry) => ((entry.createdAt ?? 0) > max ? (entry.createdAt ?? 0) : max), 0);
    return latest > 0 ? latest : Date.now();
  }, [diffs]);
  const primary = diffs[0];
  if (!primary) return null;
  const open = () => openSourceDiffBatch({ id: batchId, createdAt, payloads: diffs });
  if (diffs.length === 1) {
    const look = derive(tokens, "end-resource-link", (k) => ({ underline: mix(k.c.textBase, 35, "transparent") }));
    return (
      <box role="button" focusable title={primary.filePath} selfAlign="start" maxW="full" mt={6} hoverGroup cursor="default" radius={radius.sm} focusRing={{ color: tokens.c.ring, width: 2, offset: 0 }} onPress={open}>
        <text size={fontSize.base} lineHeight={fontSize.base * 1.4} color={tokens.c.textBase} hoverColor={tokens.c.textStrong} spans={[{ t: basenameOf(primary.filePath), u: look.underline }]} nowrap truncate />
      </box>
    );
  }
  const surface = panelSurface(tokens);
  const hover = derive(tokens, "end-resource-card:hover", (k) => mixOklch(k.c.foreground, 5, "transparent"));
  const kind = displayTabKindForPayload(primary);
  return (
    <row
      role="button"
      focusable
      title={diffs.map((entry) => entry.filePath).join("\n")}
      w="full"
      align="center"
      gap={8}
      mt={10}
      minH={52}
      pt={6 + 1}
      pr={8 + 1}
      pb={6 + 1}
      pl={12 + 1}
      radius={radius.lg}
      gradient={surface.gradient}
      border={surface.border}
      hoverBorder={tokens.c.borderStrong}
      hoverFill={hover}
      shadows={surface.shadows}
      onPress={open}
    >
      <box shrink={false} w={30} h={30} center>
        <Icon icon={Icons.display[kind as keyof typeof Icons.display] ?? Icons.display["source-diff"]} size={26} color={tokens.c.textBase} />
      </box>
      <col grow={1} minW={0} gap={1}>
        <text size={fontSize.base} weight={600} lineHeight={fontSize.base * 1.35} color={tokens.c.textStrong} nowrap truncate>
          {tPlural("app.chat.endResource.fileChangeCount", diffs.length)}
        </text>
        <text size={fontSize.base} lineHeight={fontSize.base * 1.35} color={tokens.c.textBase}>
          {t("app.chat.endResource.openInPanel")}
        </text>
      </col>
    </row>
  );
};
