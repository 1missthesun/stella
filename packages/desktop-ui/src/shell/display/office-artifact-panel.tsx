import { useMemo, useState } from "react";
import {
  Copy,
  Download,
  FileSpreadsheet,
  FileText,
  FolderOpen,
  Presentation,
} from "@/ui/icons";
import type {
  OfficePreviewFormat,
  OfficePreviewRef,
  OfficePreviewSnapshot,
} from "@stella/contracts/office-preview";
import { useT, useTPlural } from "@/shared/i18n";
import { useOfficePreview } from "@/features/chat/office-preview-store";
import { useFilePreviewActions } from "@/features/chat/hooks/use-file-preview-actions";
import { Select } from "@/ui/select";
import { PreviewProblem } from "./preview-states";
import { OfficeOutlineRail } from "./office-outline-rail";

const ZOOM_OPTIONS = [75, 100, 125, 150] as const;

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

const titleForPreview = (
  previewRef: OfficePreviewRef,
  snapshot?: OfficePreviewSnapshot,
) => snapshot?.title ?? previewRef.title;

type SheetTab = { index: number; name: string };

const parsePreviewMeta = (html?: string, kind?: ArtifactKind) => {
  const empty = { count: 0, sheets: [] as SheetTab[], activeSheet: null as number | null };
  if (!html || typeof DOMParser === "undefined") return empty;

  const doc = new DOMParser().parseFromString(html, "text/html");
  if (kind === "spreadsheet") {
    const sheets: SheetTab[] = [];
    let activeSheet: number | null = null;
    for (const node of doc.querySelectorAll<HTMLElement>(".sheet-tab[data-sheet]")) {
      const index = Number(node.getAttribute("data-sheet"));
      if (!Number.isInteger(index)) continue;
      sheets.push({ index, name: node.textContent?.trim() || String(index + 1) });
      if (activeSheet === null && node.classList.contains("active")) activeSheet = index;
    }
    return { count: sheets.length, sheets, activeSheet: activeSheet ?? sheets[0]?.index ?? null };
  }

  if (kind === "presentation") {
    return {
      ...empty,
      count: doc.querySelectorAll(".slide-container, [data-slide-index]").length,
    };
  }

  return {
    ...empty,
    count: doc.querySelectorAll("section, article, .page, [data-page]").length,
  };
};

// The preview runs no script (the frame is sandboxed and inherits the app's
// CSP), so the sheet tabs live in the panel and the chosen sheet is shown by CSS.
const injectPreviewChrome = (
  html: string,
  zoomPercent: number,
  sheet: number | null,
) => {
  const sheetRules =
    sheet === null
      ? ""
      : `
  .sheet-tabs,
  .sheet-content {
    display: none !important;
  }
  .sheet-content[data-sheet="${sheet}"] {
    display: flex !important;
    flex-direction: column;
  }`;
  const style = `
<style id="stella-artifact-preview-style">
  html {
    background: #f7f7f8 !important;
  }
  body {
    zoom: ${zoomPercent / 100};
  }
  .file-title {
    display: none !important;
  }${sheetRules}
</style>`;
  const next = html.includes("</head>")
    ? html.replace("</head>", `${style}</head>`)
    : `${style}${html}`;
  return next;
};

const StatusPanel = ({
  error,
  loading,
}: {
  error?: string | null;
  loading?: boolean;
}) => {
  const t = useT();
  if (!loading) {
    return (
      <PreviewProblem
        error={error?.trim() || t("shell.display.office.loadFailed")}
      />
    );
  }
  return (
    <div className="display-artifact-status">
      <div className="display-artifact-status__text loading-shimmer-pure-text">
        {t("shell.display.office.preparing")}
      </div>
    </div>
  );
};

const KindIcon = ({ kind }: { kind: ArtifactKind }) => {
  if (kind === "spreadsheet") return <FileSpreadsheet size={15} />;
  if (kind === "presentation") return <Presentation size={15} />;
  return <FileText size={15} />;
};

export function OfficeArtifactPanel({
  previewRef,
}: {
  previewRef: OfficePreviewRef;
}) {
  const t = useT();
  const tPlural = useTPlural();
  const snapshot = useOfficePreview(previewRef.sessionId);
  const [zoomPercent, setZoomPercent] = useState(100);
  const format = snapshot?.format ?? formatFromPath(previewRef.sourcePath);
  const kind = kindForFormat(format);
  const title = titleForPreview(previewRef, snapshot);
  const { actionStatus, handleSave, handleCopy } = useFilePreviewActions({
    sourcePath: previewRef.sourcePath,
    suggestedName: title,
  });

  const meta = useMemo(
    () => parsePreviewMeta(snapshot?.html, kind),
    [snapshot?.html, kind],
  );
  const [chosenSheet, setChosenSheet] = useState<number | null>(null);
  const sheet =
    chosenSheet !== null && meta.sheets.some((tab) => tab.index === chosenSheet)
      ? chosenSheet
      : meta.activeSheet;
  const srcDoc = useMemo(
    () =>
      snapshot?.html
        ? injectPreviewChrome(snapshot.html, zoomPercent, sheet)
        : undefined,
    [snapshot?.html, zoomPercent, sheet],
  );

  const ready = snapshot?.status === "ready" && Boolean(srcDoc);
  const error =
    snapshot?.status === "error"
      ? snapshot.error || t("shell.display.office.sessionError")
      : null;
  const loading = !snapshot || snapshot.status === "starting";

  const countLabel =
    kind === "spreadsheet" && meta.count > 0
      ? tPlural("shell.display.office.sheetCount", meta.count)
      : kind === "presentation" && meta.count > 0
        ? tPlural("shell.display.office.slideCount", meta.count)
        : t(labelKeyForKind(kind));

  return (
    <section
      className={`display-artifact-panel display-artifact-panel--${kind}`}
    >
      <header className="display-artifact-panel__header">
        <div className="display-artifact-panel__identity">
          <div className="display-artifact-panel__icon" aria-hidden>
            <KindIcon kind={kind} />
          </div>
          <div className="display-artifact-panel__title-group">
            <div className="display-artifact-panel__eyebrow">
              {t(labelKeyForKind(kind))}
            </div>
            <div
              className="display-artifact-panel__title"
              title={previewRef.sourcePath}
            >
              {title}
            </div>
          </div>
        </div>

        <div className="display-artifact-panel__center">{countLabel}</div>

        <div className="display-artifact-panel__actions">
          <Select
            className="display-artifact-panel__zoom"
            aria-label={t("shell.display.office.zoomAriaLabel")}
            value={String(zoomPercent)}
            onValueChange={(value) => {
              setZoomPercent(Number(value));
            }}
            options={ZOOM_OPTIONS.map((value) => ({
              value: String(value),
              label: `${value}%`,
            }))}
          />
          <button
            type="button"
            className="display-artifact-panel__action"
            onClick={() => {
              window.electronAPI?.system?.showItemInFolder?.(
                previewRef.sourcePath,
              );
            }}
            title={t("shell.display.office.revealInFinder")}
            aria-label={t("shell.display.office.revealInFinder")}
          >
            <FolderOpen size={14} />
          </button>
          <button
            type="button"
            className="display-artifact-panel__action"
            onClick={handleSave}
            title={t("common.save")}
            aria-label={t("common.save")}
          >
            <Download size={14} />
          </button>
          <button
            type="button"
            className="display-artifact-panel__action"
            onClick={handleCopy}
            title={t("common.copy")}
            aria-label={t("common.copy")}
          >
            <Copy size={14} />
          </button>
        </div>
      </header>

      <div className="display-artifact-panel__body">
        {ready && kind !== "spreadsheet" ? (
          <OfficeOutlineRail
            html={snapshot?.html}
            kind={kind}
            frameRef={frameRef}
          />
        ) : null}
        {ready ? (
          <iframe
            className="display-artifact-panel__frame"
            title={t("shell.display.office.frameTitle", {
              kind: t(labelKeyForKind(kind)),
              title,
            })}
            sandbox=""
            srcDoc={srcDoc}
          />
        ) : (
          <StatusPanel error={error} loading={loading} />
        )}
      </div>

      {ready && meta.sheets.length > 1 && (
        <div className="display-artifact-panel__sheets" role="tablist">
          {meta.sheets.map((tab) => (
            <button
              key={tab.index}
              type="button"
              role="tab"
              aria-selected={tab.index === sheet}
              className="display-artifact-panel__sheet"
              onClick={() => setChosenSheet(tab.index)}
            >
              {tab.name}
            </button>
          ))}
        </div>
      )}

      {(actionStatus || snapshot?.status === "ready") && (
        <footer className="display-artifact-panel__footer">
          <span>
            {snapshot?.updatedAt
              ? `Updated ${new Date(snapshot.updatedAt).toLocaleTimeString([], {
                  hour: "numeric",
                  minute: "2-digit",
                })}`
              : t("shell.display.office.livePreview")}
          </span>
          {actionStatus && <strong>{actionStatus}</strong>}
        </footer>
      )}
    </section>
  );
}
