import {
  Fragment,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { Copy, Download, LoaderCircle, Share, Trash2 } from "@/ui/icons";
import { publicFileLink } from "@/features/cloud/file-share-link";
import { useDisplayFileBlobs } from "@/shared/hooks/use-display-file-data";
import { copyImageBlob } from "@/shell/media-clipboard";
import { useT } from "@/shared/i18n";
import type { MediaTabItem } from "./media-item";

const filePathsForItem = (item: MediaTabItem): string[] => {
  switch (item.asset.kind) {
    case "image":
      return item.asset.filePaths.slice(0, 1);
    case "video":
    case "audio":
    case "model3d":
    case "download":
      return [item.asset.filePath];
    case "text":
      return [];
  }
};

export const MediaActionBar = ({
  item,
  onDelete,
}: {
  item: MediaTabItem;
  onDelete: () => void;
}) => {
  const t = useT();
  const [message, setMessage] = useState<string | null>(null);
  const [armed, setArmed] = useState(false);
  const disarmTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const filePath = useMemo(() => filePathsForItem(item)[0] ?? null, [item]);

  useEffect(
    () => () => {
      if (disarmTimer.current) clearTimeout(disarmTimer.current);
    },
    [],
  );

  const handleTrash = useCallback(() => {
    if (armed) {
      if (disarmTimer.current) clearTimeout(disarmTimer.current);
      setArmed(false);
      onDelete();
      return;
    }
    setArmed(true);
    if (disarmTimer.current) clearTimeout(disarmTimer.current);
    disarmTimer.current = setTimeout(() => setArmed(false), 2500);
  }, [armed, onDelete]);
  const { files } = useDisplayFileBlobs(filePath ? [filePath] : []);
  const blob = files[0] ?? null;

  const handleSave = useCallback(async () => {
    if (!filePath) return;
    const result = await window.electronAPI?.system?.saveFileAs?.(
      filePath,
      filePath.split(/[\\/]/).pop() ?? filePath,
    );
    if (!result || result.canceled) return;
    setMessage(
      result.ok
        ? t("shell.display.media.saved")
        : (result.error ?? t("shell.display.media.saveFailed")),
    );
  }, [filePath, t]);

  const handleCopy = useCallback(async () => {
    try {
      if (item.asset.kind === "image" && blob) {
        await copyImageBlob(blob.blob);
      } else if (item.asset.kind === "text") {
        await navigator.clipboard.writeText(item.asset.text);
      } else if (filePath) {
        await navigator.clipboard.writeText(filePath);
      } else {
        return;
      }
      setMessage(t("shell.display.media.copied"));
    } catch (err) {
      setMessage(
        err instanceof Error
          ? err.message
          : t("shell.display.media.copyFailed"),
      );
    }
  }, [blob, filePath, item, t]);

  const [sharing, setSharing] = useState(false);
  const handleShare = useCallback(async () => {
    if (!filePath || sharing) return;
    setSharing(true);
    try {
      const url = await publicFileLink(filePath, blob?.blob ?? null);
      await navigator.clipboard.writeText(url);
      setMessage(t("shell.display.media.linkCopied"));
    } catch (err) {
      setMessage(
        err instanceof Error && err.message
          ? err.message
          : t("shell.display.media.shareFailed"),
      );
    } finally {
      setSharing(false);
    }
  }, [blob, filePath, sharing, t]);

  const canSave = Boolean(filePath && window.electronAPI?.system?.saveFileAs);

  return (
    <Fragment>
      {canSave ? (
        <button
          type="button"
          className="media-tab__action-btn"
          onClick={handleSave}
          aria-label={t("shell.display.media.save")}
          title={t("shell.display.media.save")}
        >
          <Download size={14} strokeWidth={1.85} />
        </button>
      ) : null}
      <button
        type="button"
        className="media-tab__action-btn"
        onClick={handleCopy}
        aria-label={t("shell.display.media.copy")}
        title={t("shell.display.media.copy")}
      >
        <Copy size={14} strokeWidth={1.85} />
      </button>
      {filePath ? (
        <button
          type="button"
          className="media-tab__action-btn"
          onClick={handleShare}
          disabled={sharing}
          aria-label={t("shell.display.media.share")}
          title={t("shell.display.media.shareTitle")}
        >
          {sharing ? (
            <LoaderCircle size={14} strokeWidth={1.85} className="media-tab__action-spin" />
          ) : (
            <Share size={14} strokeWidth={1.85} />
          )}
        </button>
      ) : null}
      <button
        type="button"
        className={`media-tab__action-btn${
          armed ? " media-tab__action-btn--armed" : ""
        }`}
        onClick={handleTrash}
        aria-label={
          armed
            ? t("shell.display.media.deleteConfirm")
            : t("shell.display.media.delete")
        }
        title={
          armed
            ? t("shell.display.media.deleteConfirm")
            : t("shell.display.media.delete")
        }
      >
        <Trash2 size={14} strokeWidth={1.85} />
      </button>
      {message ? (
        <span className="media-tab__action-status">{message}</span>
      ) : null}
    </Fragment>
  );
};
