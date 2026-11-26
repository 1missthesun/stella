import { useCallback, useEffect, useId, useMemo, useState } from "react";
import type { OfficePreviewFormat, OfficePreviewRef, OfficePreviewSnapshot } from "@stella/contracts/office-preview";
import { useT, useTPlural } from "@/shared/i18n";
import { useOfficePreview } from "@/features/chat/office-preview-store";
import { useFilePreviewActions } from "@/features/chat/hooks/use-file-preview-actions";
import { useRegisterViewerNav, useViewerDetailReporter } from "@/shell/workspace-stage/viewer-item-context";
import { Icon, Icons, Select, type IconData } from "../../kit";
import { derive, fontSize, look, mixOklch, radius, useTokens, type Tokens } from "../../theme";
import type { WebviewMessage } from "../../../host/rune-jsx/props";
import { PreviewProblem } from "./preview-states";
import { injectOfficePreviewChrome, officeOutlinePreload, parseOfficeOutline, parseOfficePreviewMeta, type OfficeOutlineEntry, type OfficeOutlineKind } from "./office-preview-html";

const ZOOM_OPTIONS = [75, 100, 125, 150] as const;
const ZOOM_SELECT_OPTIONS = ZOOM_OPTIONS.map((value) => ({ value: String(value), label: `${value}%` }));

type ArtifactKind = "document" | "spreadsheet" | "presentation";

const formatFromPath = (sourcePath: string): OfficePreviewFormat => {
  const lower = sourcePath.toLowerCase();
  if (lower.endsWith(".docx")) return "docx";
  if (lower.endsWith(".xlsx") || lower.endsWith(".xlsm")) return "xlsx";
  if (lower.endsWith(".pptx")) return "pptx";
  return null;
};

const kindForFormat = (format: OfficePreviewFormat): ArtifactKind => {
  if (format === "xlsx") return "spreadsheet";
  if (format === "pptx") return "presentation";
  return "document";
};

const labelKeyForKind = (kind: ArtifactKind) => {
  if (kind === "spreadsheet") return "shell.display.office.kind.spreadsheet";
  if (kind === "presentation") return "shell.display.office.kind.presentation";
  return "shell.display.office.kind.document";
};

const titleForPreview = (previewRef: OfficePreviewRef, snapshot?: OfficePreviewSnapshot) => snapshot?.title ?? previewRef.title;

/** `@container file-viewer (min-width: 621px)`: the viewer is the panel plus the rich body's 12px padding. */
const OUTLINE_MIN_VIEWER_WIDTH = 621;
const RICH_PADDING = 12;
/** `@media (max-width: 720px)` hides the header's centre count. */
const NARROW_WINDOW = 720;

const officeLook = (t: Tokens) =>
  derive(t, "office-artifact-panel", (k) => ({
    iconFill: mixOklch(k.c.foreground, 4, "transparent"),
    hover: mixOklch(k.c.foreground, 7, "transparent"),
    railHover: mixOklch(k.c.foreground, 5, "transparent"),
    railCurrent: mixOklch(k.c.foreground, 8, "transparent"),
    sheetSelected: mixOklch(k.c.foreground, 10, "transparent"),
    rule: mixOklch(k.c.border, 38, "transparent"),
  }));

function useWindowWidth(): number {
  const [width, setWidth] = useState(() => window.innerWidth);
  useEffect(() => {
    const listener = () => setWidth(window.innerWidth);
    window.addEventListener("resize", listener);
    return () => window.removeEventListener("resize", listener);
  }, []);
  return width;
}

function StatusPanel({ error, loading }: { error?: string | null; loading?: boolean }) {
  const t = useT();
  const tokens = useTokens();
  if (!loading) return <PreviewProblem error={error?.trim() || t("shell.display.office.loadFailed")} />;
  return (
    <col grow={1} center pad={24}>
      <text maxW={416} {...look(fontSize.base, 400, { lh: 1.45 })} textAlign="center" color={tokens.c.textWeak}>
        {t("shell.display.office.preparing")}
      </text>
    </col>
  );
}

const kindIcon = (kind: ArtifactKind) => (kind === "spreadsheet" ? Icons.stella.FileSpreadsheet : kind === "presentation" ? Icons.stella.Presentation : Icons.stella.FileText);

function HeaderAction({ id, label, icon, onPress }: { id: string; label: string; icon: IconData; onPress: () => void }) {
  const tokens = useTokens();
  const tone = officeLook(tokens);
  return (
    <box id={id} role="button" label={label} title={label} focusable w={28} h={28} center shrink={false} radius={radius.md} border={tokens.c.border} fill={tokens.c.surfaceInset} hover={tone.hover} focusRing={{ color: tokens.c.ring, width: 2, offset: 0 }} onPress={onPress}>
      <Icon icon={icon} size={14} color={tokens.c.textBase} />
    </box>
  );
}

function OfficeOutlineRail({ entries, kind, current, onJump }: { entries: OfficeOutlineEntry[]; kind: OfficeOutlineKind; current: number; onJump: (index: number) => void }) {
  const tokens = useTokens();
  const tone = officeLook(tokens);
  return (
    <col role="navigation" label={kind === "presentation" ? "Slides" : "Outline"} w={200} shrink={false} minH={0} gap={1} py={10} px={6} scrollY borderSides={[0, 1, 0, 0]} border={tokens.c.borderWeak} fill={tokens.c.background}>
      {entries.map((entry, index) => {
        const isCurrent = index === current;
        return (
          <row
            key={index}
            role="button"
            focusable
            label={entry.label}
            title={entry.label}
            selected={isCurrent}
            shrink={false}
            align="center"
            gap={8}
            py={6}
            pr={8}
            pl={entry.level === 3 ? 28 : entry.level === 2 ? 18 : 8}
            radius={6}
            clip={6}
            fill={isCurrent ? tone.railCurrent : undefined}
            hover={isCurrent ? undefined : tone.railHover}
            onPress={() => onJump(index)}
          >
            {kind === "presentation" ? (
              <text shrink={false} minW={14} {...look(fontSize.xs, 400)} features="'tnum' 1" color={tokens.c.textWeak}>
                {String(index + 1)}
              </text>
            ) : null}
            <text minW={0} {...look(fontSize.xs, 400)} nowrap truncate color={isCurrent ? tokens.c.textStrong : entry.level === 3 ? tokens.c.textWeak : tokens.c.textBase}>
              {entry.label}
            </text>
          </row>
        );
      })}
    </col>
  );
}

const messageData = (m: WebviewMessage): { type?: unknown; [key: string]: unknown } | null => {
  let data: unknown = m.data;
  if (typeof data === "string") {
    try {
      data = JSON.parse(data);
    } catch {
      return null;
    }
  }
  return data && typeof data === "object" ? (data as { type?: unknown }) : null;
};

export function OfficeArtifactPanel({ previewRef }: { previewRef: OfficePreviewRef }) {
  const t = useT();
  const tPlural = useTPlural();
  const tokens = useTokens();
  const tone = officeLook(tokens);
  const snapshot = useOfficePreview(previewRef.sessionId);
  const [zoomPercent, setZoomPercent] = useState(100);
  const [zoomOpen, setZoomOpen] = useState(false);
  const [panelWidth, setPanelWidth] = useState(0);
  const windowWidth = useWindowWidth();
  const frameId = `office-artifact-frame-${useId().replace(/[^a-zA-Z0-9]/g, "")}`;
  const format = snapshot?.format ?? formatFromPath(previewRef.sourcePath);
  const kind = kindForFormat(format);
  const title = titleForPreview(previewRef, snapshot);
  const { actionStatus, handleSave, handleCopy } = useFilePreviewActions({ sourcePath: previewRef.sourcePath, suggestedName: title });

  const meta = useMemo(() => parseOfficePreviewMeta(snapshot?.html, kind), [snapshot?.html, kind]);
  const [chosenSheet, setChosenSheet] = useState<number | null>(null);
  const sheet = chosenSheet !== null && meta.sheets.some((tab) => tab.index === chosenSheet) ? chosenSheet : meta.activeSheet;
  const html = useMemo(() => (snapshot?.html ? injectOfficePreviewChrome(snapshot.html, zoomPercent, sheet) : undefined), [snapshot?.html, zoomPercent, sheet]);

  const ready = snapshot?.status === "ready" && Boolean(html);
  const error = snapshot?.status === "error" ? snapshot.error || t("shell.display.office.sessionError") : null;
  const loading = !snapshot || snapshot.status === "starting";

  const countLabel =
    kind === "spreadsheet" && meta.count > 0
      ? tPlural("shell.display.office.sheetCount", meta.count)
      : kind === "presentation" && meta.count > 0
        ? tPlural("shell.display.office.slideCount", meta.count)
        : t(labelKeyForKind(kind));

  const outlineKind: OfficeOutlineKind | null = ready && kind !== "spreadsheet" ? kind : null;
  const entries = useMemo(() => (outlineKind ? parseOfficeOutline(snapshot?.html, outlineKind) : []), [outlineKind, snapshot?.html]);
  const [current, setCurrent] = useState(0);
  const reportDetail = useViewerDetailReporter();

  useEffect(() => {
    if (entries.length < 2) {
      reportDetail(null);
      return;
    }
    reportDetail(outlineKind === "presentation" ? `slide ${current + 1}` : (entries[current]?.label.slice(0, 32) ?? null));
  }, [current, entries, outlineKind, reportDetail]);

  const jumpTo = useCallback(
    (index: number) => {
      void stella.engine.webview.post(frameId, { type: "stella:office-outline-jump", index }).catch(() => {});
      setCurrent(index);
    },
    [frameId],
  );

  useRegisterViewerNav(
    outlineKind && entries.length > 1
      ? {
          canPrevious: current > 0,
          canNext: current < entries.length - 1,
          previous: () => jumpTo(Math.max(0, current - 1)),
          next: () => jumpTo(Math.min(entries.length - 1, current + 1)),
          previousLabel: outlineKind === "presentation" ? "Previous slide" : "Previous section",
          nextLabel: outlineKind === "presentation" ? "Next slide" : "Next section",
        }
      : null,
  );

  const onFrameMessage = useCallback((m: WebviewMessage) => {
    const data = messageData(m);
    if (data?.type === "stella:office-outline-current" && typeof data.index === "number") setCurrent(data.index);
  }, []);

  const preload = useMemo(() => (outlineKind ? officeOutlinePreload(outlineKind) : undefined), [outlineKind]);
  const showRail = outlineKind !== null && entries.length >= 2 && panelWidth + RICH_PADDING * 2 >= OUTLINE_MIN_VIEWER_WIDTH;

  return (
    <col id="display-artifact-panel" grow={1} minH={0} w="full" pad={1} radius={radius.lg} clip={radius.lg} border={tokens.c.border} fill={tokens.c.card} onLayout={(r) => setPanelWidth(r.w)}>
      <row shrink={false} align="center" gap={12} minH={52} pt={9} px={12} pb={9 + 1} borderSides={[0, 0, 1, 0]} border={tokens.c.border} fill={tokens.c.surfaceInset}>
        <row w={0} grow={1} minW={0} align="center" gap={9}>
          <box w={28} h={28} shrink={false} center radius={radius.md} border={tokens.c.border} fill={tone.iconFill}>
            <Icon icon={kindIcon(kind)} size={15} color={tokens.c.textBase} />
          </box>
          <col minW={0}>
            <text {...look(fontSize["2xs"], 600, { lh: 1.1, em: 0.08 })} textCase="upper" color={tokens.c.textWeak}>
              {t(labelKeyForKind(kind))}
            </text>
            <text mt={3} {...look(fontSize.base, 600, { lh: 1.2 })} nowrap truncate color={tokens.c.textStrong} title={previewRef.sourcePath}>
              {title}
            </text>
          </col>
        </row>
        {windowWidth > NARROW_WINDOW ? (
          <text shrink={false} {...look(fontSize.sm, 400)} features="'tnum' 1" textAlign="center" nowrap color={tokens.c.textBase}>
            {countLabel}
          </text>
        ) : null}
        <row w={0} grow={1} minW={0} align="center" justify="end" gap={5}>
          <box w={78} shrink={false}>
            <Select
              id={`${frameId}-zoom`}
              label={t("shell.display.office.zoomAriaLabel")}
              hideLabel
              value={String(zoomPercent)}
              onValueChange={(value) => setZoomPercent(Number(value))}
              options={ZOOM_SELECT_OPTIONS}
              open={zoomOpen}
              onOpenChange={setZoomOpen}
              trigger={{ h: 28, px: 7 + 1, fill: tokens.c.surfaceInset, hover: tone.hover, color: tokens.c.textBase }}
            />
          </box>
          <HeaderAction id={`${frameId}-reveal`} label={t("shell.display.office.revealInFinder")} icon={Icons.stella.FolderOpen} onPress={() => window.electronAPI?.system?.showItemInFolder?.(previewRef.sourcePath)} />
          <HeaderAction id={`${frameId}-save`} label={t("common.save")} icon={Icons.stella.Download} onPress={handleSave} />
          <HeaderAction id={`${frameId}-copy`} label={t("common.copy")} icon={Icons.stella.Copy} onPress={handleCopy} />
        </row>
      </row>

      <row grow={1} minH={0} clip={0} fill={tokens.c.surfaceInset}>
        {showRail && outlineKind ? <OfficeOutlineRail entries={entries} kind={outlineKind} current={current} onJump={jumpTo} /> : null}
        {ready && html ? (
          <webview
            id={frameId}
            grow={1}
            minW={0}
            minH={0}
            h="full"
            label={t("shell.display.office.frameTitle", { kind: t(labelKeyForKind(kind)), title })}
            html={html}
            fill={tokens.c.card}
            {...(preload ? { preload } : {})}
            onMessage={onFrameMessage}
          />
        ) : (
          <StatusPanel error={error} loading={loading} />
        )}
      </row>

      {ready && meta.sheets.length > 1 ? (
        <row role="tablist" shrink={false} gap={2} pt={4 + 1} px={8} pb={4} scrollX borderSides={[1, 0, 0, 0]} border={tone.rule}>
          {meta.sheets.map((tab) => {
            const selected = tab.index === sheet;
            return (
              <box key={tab.index} role="tab" selected={selected} focusable shrink={false} maxW={224} py={4} px={10} radius={6} fill={selected ? tone.sheetSelected : undefined} hover={selected ? undefined : tone.hover} focusRing={{ color: tokens.c.ring, width: 2, offset: 0 }} onPress={() => setChosenSheet(tab.index)}>
                <text {...look(fontSize.xs, selected ? 600 : 400)} nowrap truncate color={selected ? tokens.c.textBase : tokens.c.textWeak}>
                  {tab.name}
                </text>
              </box>
            );
          })}
        </row>
      ) : null}

      {actionStatus || snapshot?.status === "ready" ? (
        <row shrink={false} align="center" justify="between" gap={10} minH={30} pt={6 + 1} px={12} pb={6} borderSides={[1, 0, 0, 0]} border={tone.rule}>
          <text {...look(fontSize.xs, 400)} color={tokens.c.textWeak}>
            {snapshot?.updatedAt ? `Updated ${new Date(snapshot.updatedAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}` : t("shell.display.office.livePreview")}
          </text>
          {actionStatus ? (
            <text {...look(fontSize.xs, 600)} color={tokens.c.textBase}>
              {actionStatus}
            </text>
          ) : null}
        </row>
      ) : null}
    </col>
  );
}
