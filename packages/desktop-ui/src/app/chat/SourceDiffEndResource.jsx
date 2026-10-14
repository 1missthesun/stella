import { useCallback, useMemo } from "react";
import { DisplayTabIcon } from "@/features/workspace-display/icons";
import { openSourceDiffBatch } from "@/features/workspace-display/open-payload";
import { displayTabKindForPayload } from "@/features/workspace-display/payload-kind";
import { basenameOf } from "@/features/workspace-display/path-to-viewer";
import { useT, useTPlural } from "@/shared/i18n";
import "./end-resource-card.css";
export const SourceDiffEndResource = ({ batchId, payloads, }) => {
    const t = useT();
    const tPlural = useTPlural();
    const sourceDiffPayloads = useMemo(() => payloads.filter((entry) => entry.kind === "source-diff"), [payloads]);
    const isMulti = sourceDiffPayloads.length > 1;
    const primary = sourceDiffPayloads[0];
    const createdAt = useMemo(() => {
        const latest = sourceDiffPayloads.reduce((max, entry) => entry.kind === "source-diff" && (entry.createdAt ?? 0) > max
            ? (entry.createdAt ?? 0)
            : max, 0);
        return latest > 0 ? latest : Date.now();
    }, [sourceDiffPayloads]);
    const handleClick = useCallback(() => {
        if (sourceDiffPayloads.length === 0)
            return;
        openSourceDiffBatch({
            id: batchId,
            createdAt,
            payloads: sourceDiffPayloads,
        });
    }, [batchId, createdAt, sourceDiffPayloads]);
    if (!primary)
        return null;
    if (!isMulti) {
        const tooltip = primary.kind === "source-diff" ? primary.filePath : undefined;
        const label = primary.kind === "source-diff" ? basenameOf(primary.filePath) : "";
        return (<button type="button" className="end-resource-link" onClick={handleClick} title={tooltip}>
        <span className="end-resource-link__label">{label}</span>
      </button>);
    }
    const kind = displayTabKindForPayload(primary);
    return (<button type="button" className="end-resource-card" onClick={handleClick} title={sourceDiffPayloads
            .map((entry) => entry.kind === "source-diff" ? entry.filePath : "")
            .filter(Boolean)
            .join("\n")}>
      <span className="end-resource-card__icon">
        <DisplayTabIcon kind={kind} size={26}/>
      </span>
      <span className="end-resource-card__text">
        <span className="end-resource-card__label">
          {tPlural("app.chat.endResource.fileChangeCount", sourceDiffPayloads.length)}
        </span>
        <span className="end-resource-card__action" aria-hidden>
          {t("app.chat.endResource.openInPanel")}
        </span>
      </span>
    </button>);
};
