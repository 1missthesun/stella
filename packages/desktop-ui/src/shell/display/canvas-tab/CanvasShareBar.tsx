import { useCallback, useContext, useState } from "react";
import {
  Check,
  Copy,
  ExternalLink,
  Globe,
  Link,
  LoaderCircle,
  Lock,
  Trash2,
} from "@/ui/icons";
import { Popover, PopoverContent, PopoverTrigger } from "@/ui/popover";
import { showToast } from "@/ui/toast";
import {
  canvasLinkKey,
  useCanvasLink,
  useCanvasShare,
  useSharedCanvasLinks,
  type CanvasLinkVisibility,
  type SharedCanvasLink,
} from "@/features/canvas-share/canvas-share-context";
import type { CanvasHtmlItem } from "./canvas-items";
import { useT } from "@/shared/i18n";
import { deviceFileMissingMessage } from "@stella/contracts/device-files";
import { SHARE_MAX_HTML_BYTES } from "@stella/contracts/backend/shares";
import {
  DisplayFileSourceContext,
  type DisplayFileSource,
} from "@/shared/hooks/display-file-source";
import "./canvas-share.css";

const decoder = new TextDecoder("utf-8");

const readCanvasHtml = async (
  filePath: string,
  source: DisplayFileSource | null,
): Promise<string> => {
  if (source) return decoder.decode((await source.read(filePath)).bytes);
  const readFile = window.electronAPI?.display?.readFile;
  if (typeof readFile !== "function") {
    throw new Error("Canvas file access requires the Stella desktop app.");
  }
  const result = await readFile(filePath);
  if (result.missing) {
    throw new Error(deviceFileMissingMessage(result.reason, filePath));
  }
  return decoder.decode(result.bytes);
};

class CanvasTooLargeError extends Error {}

const megabytes = (bytes: number): string => {
  const value = bytes / (1024 * 1024);
  return `${value >= 10 ? Math.round(value) : Math.round(value * 10) / 10} MB`;
};

const readShareableHtml = async (
  filePath: string,
  source: DisplayFileSource | null,
): Promise<string> => {
  const html = await readCanvasHtml(filePath, source);
  const bytes = new TextEncoder().encode(html).byteLength;
  if (bytes > SHARE_MAX_HTML_BYTES) {
    throw new CanvasTooLargeError(
      `This canvas is ${megabytes(bytes)}; a public link can hold up to ${megabytes(SHARE_MAX_HTML_BYTES)}.`,
    );
  }
  return html;
};

/** The reason to show when it is something the user can act on (a size limit, a missing file). */
const publishFailureReason = (error: unknown): string | null => {
  if (error instanceof CanvasTooLargeError) return error.message;
  const code =
    error && typeof error === "object" && "code" in error ? error.code : null;
  return (code === "BAD_REQUEST" || code === "NOT_FOUND") && error instanceof Error
    ? error.message
    : null;
};

const drivePathOf = (
  item: CanvasHtmlItem,
  source: DisplayFileSource | null,
): string | null => {
  const path =
    source?.drivePath ??
    (item.driveBacked ? item.filePath.replace(/^\/+/u, "") : null);
  return path && /\.html?$/iu.test(path) ? path : null;
};

const copyToClipboard = async (value: string): Promise<void> => {
  await navigator.clipboard.writeText(value);
};

const openInSystemBrowser = (url: string): void => {
  if (window.electronAPI?.system.openExternal) {
    window.electronAPI.system.openExternal(url);
    return;
  }
  window.open(url, "_blank", "noopener,noreferrer");
};

const formatDate = (ms: number): string => {
  try {
    return new Date(ms).toLocaleDateString(undefined, {
      month: "short",
      day: "numeric",
    });
  } catch {
    return "";
  }
};

const isPublicLink = (link: SharedCanvasLink): boolean =>
  link.visibility !== "private";

const canvasKeyOf = (item: CanvasHtmlItem): string | null =>
  canvasLinkKey(
    item.slug ??
      item.filePath
        .split(/[\\/]/)
        .pop()
        ?.replace(/\.html?$/i, ""),
  );

const useCopyLink = () => {
  const t = useT();
  const [copied, setCopied] = useState<string | null>(null);
  const copy = useCallback(
    async (url: string) => {
      try {
        await copyToClipboard(url);
        setCopied(url);
        showToast(t("shell.display.canvasShare.toasts.linkCopied"));
        window.setTimeout(() => setCopied(null), 1600);
      } catch {
        showToast(t("shell.display.canvasShare.toasts.copyFailed"));
      }
    },
    [t],
  );
  return { copied, copy };
};

type Pending = CanvasLinkVisibility | "open" | null;

const CanvasLinkPanel = ({ item }: { item: CanvasHtmlItem }) => {
  const t = useT();
  const share = useCanvasShare();
  const fileSource = useContext(DisplayFileSourceContext);
  const canvas = canvasKeyOf(item);
  const linkView = useCanvasLink(share ? canvas : null);
  const [published, setPublished] = useState<SharedCanvasLink | null>(null);
  const link = canvas ? linkView.value : published;
  const [pending, setPending] = useState<Pending>(null);
  const [failed, setFailed] = useState<{ reason: string | null } | null>(null);
  const drivePath = drivePathOf(item, fileSource);
  const { copied, copy } = useCopyLink();

  const setVisibility = useCallback(
    async (visibility: CanvasLinkVisibility) => {
      if (!share) return;
      setPending(visibility);
      setFailed(null);
      try {
        if (link) {
          const saved = await share.setVisibility({ slug: link.slug, visibility });
          if (!canvas) setPublished({ ...link, visibility: saved.visibility });
        } else if (canvas && drivePath) {
          await share.saveDriveDocument({
            canvas,
            path: drivePath,
            title: item.title,
            visibility,
          });
        } else if (canvas) {
          await share.save({
            canvas,
            html: await readShareableHtml(item.filePath, fileSource),
            title: item.title,
            visibility,
          });
        } else {
          const result = await share.publish({
            html: await readShareableHtml(item.filePath, fileSource),
            title: item.title,
          });
          setPublished({
            ...result,
            title: item.title,
            createdAt: Date.now(),
            visibility: "public",
            canvas: null,
          });
        }
        showToast(
          t(
            visibility === "public"
              ? "shell.display.canvasShare.toasts.madePublic"
              : "shell.display.canvasShare.toasts.madePrivate",
          ),
        );
      } catch (error) {
        setFailed({ reason: publishFailureReason(error) });
        showToast(t("shell.display.canvasShare.toasts.visibilityFailed"));
      } finally {
        setPending(null);
      }
    },
    [share, link, canvas, drivePath, fileSource, item.filePath, item.title, t],
  );

  const onOpen = useCallback(async () => {
    if (!share || !link) return;
    setPending("open");
    try {
      openInSystemBrowser(await share.viewLink({ slug: link.slug }));
    } catch {
      showToast(t("shell.display.canvasShare.toasts.openFailed"));
    } finally {
      setPending(null);
    }
  }, [share, link, t]);

  if (canvas && link === undefined && linkView.status !== "error") {
    return (
      <div className="canvas-share__state">
        <LoaderCircle size={15} className="canvas-share__spin" aria-hidden />
        <span>{t("common.loading")}</span>
      </div>
    );
  }

  if (!link) {
    return (
      <div className="canvas-share__result">
        <div className="canvas-share__hint">
          {t("shell.display.canvasShare.noLink")}
        </div>
        {failed ? (
          <div className="canvas-share__state canvas-share__state--error">
            {failed.reason ?? t("shell.display.canvasShare.publishFailed")}
          </div>
        ) : null}
        <div className="canvas-share__actions">
          <button
            type="button"
            className="canvas-share__btn canvas-share__btn--primary"
            disabled={pending !== null}
            onClick={() => void setVisibility("public")}
          >
            {pending === "public" ? (
              <LoaderCircle size={14} className="canvas-share__spin" aria-hidden />
            ) : (
              <Globe size={14} strokeWidth={1.6} aria-hidden />
            )}
            <span>{t("shell.display.canvasShare.makePublic")}</span>
          </button>
        </div>
      </div>
    );
  }

  const isPublic = isPublicLink(link);
  return (
    <div className="canvas-share__result">
      <div className="canvas-share__result-head">
        {isPublic ? (
          <Globe size={14} strokeWidth={1.6} aria-hidden />
        ) : (
          <Lock size={14} strokeWidth={1.6} aria-hidden />
        )}
        <span>
          {t(
            isPublic
              ? "shell.display.canvasShare.live"
              : "shell.display.canvasShare.privateLink",
          )}
        </span>
      </div>
      <div className="canvas-share__hint">
        {t(
          isPublic
            ? "shell.display.canvasShare.publicHint"
            : "shell.display.canvasShare.privateHint",
        )}
      </div>
      <div className="canvas-share__url-row">
        <input
          className="canvas-share__url"
          value={link.url}
          readOnly
          spellCheck={false}
          onFocus={(event) => event.currentTarget.select()}
          aria-label={t(
            isPublic
              ? "shell.display.canvasShare.publicLink"
              : "shell.display.canvasShare.privateLink",
          )}
        />
        <button
          type="button"
          className="canvas-share__copy"
          onClick={() => void copy(link.url)}
          aria-label={t("shell.display.canvasShare.copyLink")}
        >
          {copied === link.url ? (
            <Check size={14} strokeWidth={2} aria-hidden />
          ) : (
            <Copy size={14} strokeWidth={1.6} aria-hidden />
          )}
        </button>
      </div>
      <div className="canvas-share__actions">
        <button
          type="button"
          className={
            isPublic
              ? "canvas-share__btn"
              : "canvas-share__btn canvas-share__btn--primary"
          }
          disabled={pending !== null}
          onClick={() => void setVisibility(isPublic ? "private" : "public")}
        >
          {pending === "public" || pending === "private" ? (
            <LoaderCircle size={14} className="canvas-share__spin" aria-hidden />
          ) : isPublic ? (
            <Lock size={14} strokeWidth={1.6} aria-hidden />
          ) : (
            <Globe size={14} strokeWidth={1.6} aria-hidden />
          )}
          <span>
            {t(
              isPublic
                ? "shell.display.canvasShare.makePrivate"
                : "shell.display.canvasShare.makePublic",
            )}
          </span>
        </button>
        <button
          type="button"
          className="canvas-share__btn"
          disabled={pending !== null}
          onClick={() => void onOpen()}
        >
          {pending === "open" ? (
            <LoaderCircle size={14} className="canvas-share__spin" aria-hidden />
          ) : (
            <ExternalLink size={14} strokeWidth={1.6} aria-hidden />
          )}
          <span>{t("shell.display.canvasShare.openInBrowser")}</span>
        </button>
      </div>
      {link.expiresAt ? (
        <div className="canvas-share__meta">
          {t("shell.display.canvasShare.expires", {
            date: formatDate(link.expiresAt),
          })}
        </div>
      ) : null}
    </div>
  );
};

const SharedLinksPanel = () => {
  const t = useT();
  const share = useCanvasShare();
  const live = useSharedCanvasLinks();
  const links = live.value ? live.value.filter(isPublicLink) : null;
  const error = live.status === "error" && links === null;
  const [busy, setBusy] = useState<string | null>(null);
  const { copied, copy } = useCopyLink();

  const onTakeDown = useCallback(
    async (link: SharedCanvasLink) => {
      if (!share) return;
      setBusy(link.slug);
      try {
        if (link.canvas) {
          await share.setVisibility({ slug: link.slug, visibility: "private" });
          showToast(t("shell.display.canvasShare.toasts.madePrivate"));
        } else {
          await share.revoke({ slug: link.slug });
          showToast(t("shell.display.canvasShare.toasts.revoked"));
        }
      } catch {
        showToast(
          t(
            link.canvas
              ? "shell.display.canvasShare.toasts.visibilityFailed"
              : "shell.display.canvasShare.toasts.revokeFailed",
          ),
        );
      } finally {
        setBusy(null);
      }
    },
    [share, t],
  );

  return (
    <div className="canvas-share__links">
      <div className="canvas-share__links-title">
        {t("shell.display.canvasShare.sharedLinks")}
      </div>
      {error ? (
        <div className="canvas-share__state canvas-share__state--error">
          {t("shell.display.canvasShare.loadFailed")}
        </div>
      ) : links === null ? (
        <div className="canvas-share__state">
          <LoaderCircle size={15} className="canvas-share__spin" aria-hidden />
          <span>{t("common.loading")}</span>
        </div>
      ) : links.length === 0 ? (
        <div className="canvas-share__empty">
          {t("shell.display.canvasShare.empty")}
        </div>
      ) : (
        <ul className="canvas-share__list">
          {links.map((link) => (
            <li key={link.slug} className="canvas-share__item">
              <div className="canvas-share__item-main">
                <span className="canvas-share__item-title">
                  {link.title?.trim() || t("shell.display.canvasShare.untitled")}
                </span>
                <span className="canvas-share__item-url">{link.url}</span>
                <span className="canvas-share__item-meta">
                  {link.expiresAt
                    ? t("shell.display.canvasShare.sharedWithExpiry", {
                        shared: formatDate(link.createdAt),
                        expires: formatDate(link.expiresAt),
                      })
                    : t("shell.display.canvasShare.shared", {
                        date: formatDate(link.createdAt),
                      })}
                </span>
              </div>
              <div className="canvas-share__item-actions">
                <button
                  type="button"
                  className="canvas-share__icon-btn"
                  aria-label={t("shell.display.canvasShare.copyLink")}
                  onClick={() => void copy(link.url)}
                >
                  {copied === link.url ? (
                    <Check size={13} strokeWidth={2} aria-hidden />
                  ) : (
                    <Copy size={13} strokeWidth={1.6} aria-hidden />
                  )}
                </button>
                <button
                  type="button"
                  className="canvas-share__icon-btn canvas-share__icon-btn--danger"
                  aria-label={t(
                    link.canvas
                      ? "shell.display.canvasShare.makePrivate"
                      : "shell.display.canvasShare.revoke",
                  )}
                  title={t(
                    link.canvas
                      ? "shell.display.canvasShare.makePrivate"
                      : "shell.display.canvasShare.revoke",
                  )}
                  disabled={busy === link.slug}
                  onClick={() => void onTakeDown(link)}
                >
                  {busy === link.slug ? (
                    <LoaderCircle
                      size={13}
                      className="canvas-share__spin"
                      aria-hidden
                    />
                  ) : link.canvas ? (
                    <Lock size={13} strokeWidth={1.6} aria-hidden />
                  ) : (
                    <Trash2 size={13} strokeWidth={1.6} aria-hidden />
                  )}
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
};

export const CanvasShareBar = ({ item }: { item: CanvasHtmlItem }) => {
  const t = useT();
  const share = useCanvasShare();
  const canvas = canvasKeyOf(item);
  const link = useCanvasLink(share ? canvas : null).value;
  const [shareOpen, setShareOpen] = useState(false);
  const [linksOpen, setLinksOpen] = useState(false);

  if (!share) return null;

  const isPublic = link ? isPublicLink(link) : false;

  return (
    <div className="canvas-share">
      <Popover open={shareOpen} onOpenChange={setShareOpen}>
        <PopoverTrigger asChild>
          <button
            type="button"
            className="canvas-share__btn canvas-share__btn--primary"
          >
            <Globe size={14} strokeWidth={1.6} aria-hidden />
            <span>
              {t(
                isPublic
                  ? "shell.display.canvasShare.public"
                  : "shell.display.canvasShare.share",
              )}
            </span>
          </button>
        </PopoverTrigger>
        <PopoverContent
          className="canvas-share__popover"
          align="end"
          side="bottom"
          sideOffset={8}
        >
          {shareOpen ? <CanvasLinkPanel item={item} /> : null}
        </PopoverContent>
      </Popover>

      <Popover open={linksOpen} onOpenChange={setLinksOpen}>
        <PopoverTrigger asChild>
          <button
            type="button"
            className="canvas-share__btn canvas-share__btn--icon"
            aria-label={t("shell.display.canvasShare.sharedLinks")}
            title={t("shell.display.canvasShare.sharedLinks")}
          >
            <Link size={15} strokeWidth={1.6} aria-hidden />
          </button>
        </PopoverTrigger>
        <PopoverContent
          className="canvas-share__popover canvas-share__popover--links"
          align="end"
          side="bottom"
          sideOffset={8}
        >
          {linksOpen ? <SharedLinksPanel /> : null}
        </PopoverContent>
      </Popover>
    </div>
  );
};
