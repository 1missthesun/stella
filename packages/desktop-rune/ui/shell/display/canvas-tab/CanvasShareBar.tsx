import { useCallback, useContext, useState, type ReactNode } from "react";
import { copyTextToClipboard } from "@/shared/lib/clipboard";
import { showToast } from "@/ui/toast";
import { canvasLinkKey, useCanvasLink, useCanvasShare, useSharedCanvasLinks, type CanvasLinkVisibility, type SharedCanvasLink } from "@/features/canvas-share/canvas-share-context";
import type { CanvasHtmlItem } from "@/shell/display/canvas-tab/canvas-items";
import { useT } from "@/shared/i18n";
import { deviceFileMissingMessage } from "@stella/contracts/device-files";
import { SHARE_MAX_HTML_BYTES } from "@stella/contracts/backend/shares";
import { DisplayFileSourceContext, type DisplayFileSource } from "@/shared/hooks/display-file-source";
import { Icon, Icons, Popover, withStroke, type IconData } from "../../../kit";
import { derive, fontSize, look, mixOklch, radius, useTokens, type Tokens } from "../../../theme";

const decoder = new TextDecoder("utf-8");

const readCanvasHtml = async (filePath: string, source: DisplayFileSource | null): Promise<string> => {
  if (source) return decoder.decode((await source.read(filePath)).bytes);
  const readFile = window.electronAPI?.display?.readFile;
  if (typeof readFile !== "function") throw new Error("Canvas file access requires the Stella desktop app.");
  const result = await readFile(filePath);
  if (result.missing) throw new Error(deviceFileMissingMessage(result.reason, filePath));
  return decoder.decode(result.bytes);
};

class CanvasTooLargeError extends Error {}

const megabytes = (bytes: number): string => {
  const value = bytes / (1024 * 1024);
  return `${value >= 10 ? Math.round(value) : Math.round(value * 10) / 10} MB`;
};

const readShareableHtml = async (filePath: string, source: DisplayFileSource | null): Promise<string> => {
  const html = await readCanvasHtml(filePath, source);
  const bytes = new TextEncoder().encode(html).byteLength;
  if (bytes > SHARE_MAX_HTML_BYTES) throw new CanvasTooLargeError(`This canvas is ${megabytes(bytes)}; a public link can hold up to ${megabytes(SHARE_MAX_HTML_BYTES)}.`);
  return html;
};

const publishFailureReason = (error: unknown): string | null => {
  if (error instanceof CanvasTooLargeError) return error.message;
  const code = error && typeof error === "object" && "code" in error ? error.code : null;
  return (code === "BAD_REQUEST" || code === "NOT_FOUND") && error instanceof Error ? error.message : null;
};

const drivePathOf = (item: CanvasHtmlItem, source: DisplayFileSource | null): string | null => {
  const path = item.cloudDrivePath ?? source?.drivePath ?? (item.driveBacked ? item.filePath.replace(/^\/+/u, "") : null);
  return path && /\.html?$/iu.test(path) ? path : null;
};

const openInSystemBrowser = (url: string): void => {
  window.electronAPI?.system.openExternal?.(url);
};

const formatDate = (ms: number): string => {
  try {
    return new Date(ms).toLocaleDateString(undefined, { month: "short", day: "numeric" });
  } catch {
    return "";
  }
};

const isPublicLink = (link: SharedCanvasLink): boolean => link.visibility !== "private";

const canvasKeyOf = (item: CanvasHtmlItem): string | null =>
  canvasLinkKey(
    item.slug ??
      item.filePath
        .split(/[\\/]/)
        .pop()
        ?.replace(/\.html?$/i, ""),
  );

const shareLook = (t: Tokens) =>
  derive(t, "canvas-share", (t) => ({
    pillBorder: mixOklch(t.c.foreground, 12, "transparent"),
    pillFill: mixOklch(t.c.background, 82, "transparent"),
    pillHover: mixOklch(t.c.foreground, 10, "transparent"),
    primaryBorder: mixOklch(t.vars["--primary"] ?? t.c.foreground, 40, "transparent"),
    fieldBorder: mixOklch(t.c.foreground, 14, "transparent"),
    fieldFill: mixOklch(t.c.foreground, 5, "transparent"),
    iconHover: mixOklch(t.c.foreground, 8, "transparent"),
    rowHover: mixOklch(t.c.foreground, 5, "transparent"),
    error: mixOklch(t.c.destructive, 72, t.c.textBase),
    danger: mixOklch(t.c.destructive, 76, t.c.textBase),
  }));

const TEXT = look(fontSize.sm, 400);
// `.canvas-share__popover` inherits the body's 1.5 line height; only hints set 1.45.
const TEXT_POPOVER = look(fontSize.sm, 400, { lh: 1.5 });
const TEXT_MEDIUM = look(fontSize.sm, 500, { lh: 1.5 });
const META = look(fontSize.xs, 400, { lh: 1.5 });

const useCopyLink = () => {
  const t = useT();
  const [copied, setCopied] = useState<string | null>(null);
  const copy = useCallback(
    async (url: string) => {
      if (await copyTextToClipboard(url)) {
        setCopied(url);
        showToast(t("shell.display.canvasShare.toasts.linkCopied"));
        window.setTimeout(() => setCopied(null), 1600);
      } else {
        showToast(t("shell.display.canvasShare.toasts.copyFailed"));
      }
    },
    [t],
  );
  return { copied, copy };
};

function GlyphIcon({ icon, size, strokeWidth, color, hoverColor, spin }: { icon: IconData; size: number; strokeWidth: number; color: string; hoverColor: string; spin?: number }) {
  const data = withStroke(icon, strokeWidth);
  return <icon svg={data.body} name={data.name} view={data.view} size={size} color={color} hoverColor={hoverColor} spin={spin} />;
}

/** `.canvas-share__btn`: a frosted pill; `--primary` tints the border, `--icon` is a 28pt circle. */
function PillButton({ id, icon, label, text, primary = false, iconOnly = false, open = false, disabled = false, busy = false, onPress }: { id: string; icon: IconData; label?: string; text?: string; primary?: boolean; iconOnly?: boolean; open?: boolean; disabled?: boolean; busy?: boolean; onPress: () => void }) {
  const t = useTokens();
  const l = shareLook(t);
  const color = primary || open ? t.c.textStrong : t.c.textBase;
  return (
    <row
      id={id}
      role="button"
      label={label ?? text}
      title={iconOnly ? label : undefined}
      expanded={open}
      focusable={!disabled}
      disabled={disabled}
      minH={28}
      w={iconOnly ? 28 : undefined}
      px={iconOnly ? 0 : 11}
      py={iconOnly ? 0 : 5}
      gap={6}
      align="center"
      justify="center"
      radius={999}
      border={primary ? l.primaryBorder : l.pillBorder}
      fill={open ? l.pillHover : l.pillFill}
      hover={disabled ? undefined : l.pillHover}
      backdropBlur={10}
      opacity={disabled ? 0.6 : 1}
      motion={{ dur: 0.12 }}
      focusRing={{ width: 2, offset: 0, color: t.c.ring, radius: 999 }}
      hoverGroup
      noWindowDrag
      onPress={disabled ? undefined : onPress}
    >
      <GlyphIcon icon={busy ? Icons.stella.LoaderCircle : icon} size={iconOnly ? 15 : 14} strokeWidth={1.6} color={color} hoverColor={t.c.textStrong} spin={busy ? 0.8 : undefined} />
      {text ? (
        <text {...TEXT_MEDIUM} color={color} hoverColor={t.c.textStrong} nowrap>
          {text}
        </text>
      ) : null}
    </row>
  );
}

/** `.canvas-share__copy` / `.canvas-share__icon-btn`: a square outlined icon button. */
function SquareButton({ id, icon, label, size = 30, iconSize = 14, danger = false, disabled = false, busy = false, onPress }: { id: string; icon: IconData; label: string; size?: number; iconSize?: number; danger?: boolean; disabled?: boolean; busy?: boolean; onPress: () => void }) {
  const t = useTokens();
  const l = shareLook(t);
  return (
    <box
      id={id}
      role="button"
      label={label}
      title={label}
      focusable={!disabled}
      disabled={disabled}
      w={size}
      h={size}
      shrink={false}
      center
      radius={radius.md}
      border={l.fieldBorder}
      hover={disabled ? undefined : l.iconHover}
      opacity={disabled ? 0.6 : 1}
      motion={{ dur: 0.12 }}
      hoverGroup
      onPress={disabled ? undefined : onPress}
    >
      <GlyphIcon icon={busy ? Icons.stella.LoaderCircle : icon} size={iconSize} strokeWidth={busy ? 2 : 1.6} color={t.c.textBase} hoverColor={danger ? l.danger : t.c.textStrong} spin={busy ? 0.8 : undefined} />
    </box>
  );
}

function State({ error = false, children }: { error?: boolean; children: ReactNode }) {
  const t = useTokens();
  const l = shareLook(t);
  return (
    <row align="center" gap={8} py={4} px={2}>
      {error ? null : <Icon icon={Icons.stella.LoaderCircle} size={15} strokeWidth={2} color={t.c.textWeak} spin={0.8} />}
      <text {...TEXT_POPOVER} color={error ? l.error : t.c.textWeak}>
        {children}
      </text>
    </row>
  );
}

type Pending = CanvasLinkVisibility | "open" | null;

function CanvasLinkPanel({ item }: { item: CanvasHtmlItem }) {
  const t = useT();
  const tk = useTokens();
  const l = shareLook(tk);
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
          await share.saveDriveDocument({ canvas, path: drivePath, title: item.title, visibility });
        } else if (canvas) {
          await share.save({ canvas, html: await readShareableHtml(item.filePath, fileSource), title: item.title, visibility });
        } else {
          const result = await share.publish({ html: await readShareableHtml(item.filePath, fileSource), title: item.title });
          setPublished({ ...result, title: item.title, createdAt: Date.now(), visibility: "public", canvas: null });
        }
        showToast(t(visibility === "public" ? "shell.display.canvasShare.toasts.madePublic" : "shell.display.canvasShare.toasts.madePrivate"));
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

  if (canvas && link === undefined && linkView.status !== "error") return <State>{t("common.loading")}</State>;

  if (!link) {
    return (
      <col gap={10}>
        <text {...TEXT} color={tk.c.textWeak}>
          {t("shell.display.canvasShare.noLink")}
        </text>
        {failed ? <State error>{failed.reason ?? t("shell.display.canvasShare.publishFailed")}</State> : null}
        <row wrap align="center" gap={6}>
          <PillButton id="canvas-share-make-public" icon={Icons.stella.Globe} text={t("shell.display.canvasShare.makePublic")} primary disabled={pending !== null} busy={pending === "public"} onPress={() => void setVisibility("public")} />
        </row>
      </col>
    );
  }

  const isPublic = isPublicLink(link);
  const linkLabel = t(isPublic ? "shell.display.canvasShare.publicLink" : "shell.display.canvasShare.privateLink");
  return (
    <col gap={10}>
      <row align="center" gap={6}>
        <Icon icon={isPublic ? Icons.stella.Globe : Icons.stella.Lock} size={14} strokeWidth={1.6} color={tk.c.textStrong} />
        <text {...TEXT_MEDIUM} color={tk.c.textStrong}>
          {t(isPublic ? "shell.display.canvasShare.live" : "shell.display.canvasShare.privateLink")}
        </text>
      </row>
      <text {...TEXT} color={tk.c.textWeak}>
        {t(isPublic ? "shell.display.canvasShare.publicHint" : "shell.display.canvasShare.privateHint")}
      </text>
      <row align="center" gap={6}>
        <input id="canvas-share-url" grow={1} minW={0} h={30} px={11} radius={radius.md} border={l.fieldBorder} fill={l.fieldFill} {...TEXT} color={tk.c.textBase} value={link.url} readOnly selectOnFocus spellcheck={false} label={linkLabel} focusRing={{ width: 2, offset: 0, color: tk.c.ring, radius: radius.md }} />
        <SquareButton id="canvas-share-copy" icon={copied === link.url ? Icons.stella.Check : Icons.stella.Copy} label={t("shell.display.canvasShare.copyLink")} onPress={() => void copy(link.url)} />
      </row>
      <row wrap align="center" gap={6}>
        <PillButton
          id="canvas-share-visibility"
          icon={isPublic ? Icons.stella.Lock : Icons.stella.Globe}
          text={t(isPublic ? "shell.display.canvasShare.makePrivate" : "shell.display.canvasShare.makePublic")}
          primary={!isPublic}
          disabled={pending !== null}
          busy={pending === "public" || pending === "private"}
          onPress={() => void setVisibility(isPublic ? "private" : "public")}
        />
        <PillButton id="canvas-share-open" icon={Icons.stella.ExternalLink} text={t("shell.display.canvasShare.openInBrowser")} disabled={pending !== null} busy={pending === "open"} onPress={() => void onOpen()} />
      </row>
      {link.expiresAt ? (
        <text {...META} color={tk.c.textWeak}>
          {t("shell.display.canvasShare.expires", { date: formatDate(link.expiresAt) })}
        </text>
      ) : null}
    </col>
  );
}

function SharedLinksPanel() {
  const t = useT();
  const tk = useTokens();
  const l = shareLook(tk);
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
        showToast(t(link.canvas ? "shell.display.canvasShare.toasts.visibilityFailed" : "shell.display.canvasShare.toasts.revokeFailed"));
      } finally {
        setBusy(null);
      }
    },
    [share, t],
  );

  return (
    <col gap={8}>
      <text {...TEXT_MEDIUM} color={tk.c.textStrong}>
        {t("shell.display.canvasShare.sharedLinks")}
      </text>
      {error ? (
        <State error>{t("shell.display.canvasShare.loadFailed")}</State>
      ) : links === null ? (
        <State>{t("common.loading")}</State>
      ) : links.length === 0 ? (
        <text {...TEXT} color={tk.c.textWeak} py={6} px={2}>
          {t("shell.display.canvasShare.empty")}
        </text>
      ) : (
        <col role="list" gap={4} maxH={320} scrollY>
          {links.map((link) => {
            const takeDown = t(link.canvas ? "shell.display.canvasShare.makePrivate" : "shell.display.canvasShare.revoke");
            return (
              <row key={link.slug} role="listitem" align="center" gap={8} pad={8} radius={radius.md} hover={l.rowHover}>
                <col grow={1} minW={0} gap={2}>
                  <text {...TEXT_MEDIUM} color={tk.c.textStrong} nowrap truncate>
                    {link.title?.trim() || t("shell.display.canvasShare.untitled")}
                  </text>
                  <text {...TEXT_POPOVER} color={tk.c.textWeak} nowrap truncate>
                    {link.url}
                  </text>
                  <text {...META} color={tk.c.textWeak}>
                    {link.expiresAt
                      ? t("shell.display.canvasShare.sharedWithExpiry", { shared: formatDate(link.createdAt), expires: formatDate(link.expiresAt) })
                      : t("shell.display.canvasShare.shared", { date: formatDate(link.createdAt) })}
                  </text>
                </col>
                <row shrink={false} align="center" gap={4}>
                  <SquareButton id={`canvas-share-copy-${link.slug}`} icon={copied === link.url ? Icons.stella.Check : Icons.stella.Copy} iconSize={13} size={26} label={t("shell.display.canvasShare.copyLink")} onPress={() => void copy(link.url)} />
                  <SquareButton id={`canvas-share-take-down-${link.slug}`} icon={link.canvas ? Icons.stella.Lock : Icons.stella.Trash2} iconSize={13} size={26} danger label={takeDown} disabled={busy === link.slug} busy={busy === link.slug} onPress={() => void onTakeDown(link)} />
                </row>
              </row>
            );
          })}
        </col>
      )}
    </col>
  );
}

/** desktop-ui's `CanvasShareBar`: Share (or Public) and the shared-links list, top right over the canvas. */
export const CanvasShareBar = ({ item }: { item: CanvasHtmlItem }) => {
  const t = useT();
  const share = useCanvasShare();
  const canvas = canvasKeyOf(item);
  const link = useCanvasLink(share ? canvas : null).value;
  const [shareOpen, setShareOpen] = useState(false);
  const [linksOpen, setLinksOpen] = useState(false);

  if (!share) return null;
  const isPublic = link ? isPublicLink(link) : false;
  const key = item.id.replace(/[^\w-]/gu, "_");

  return (
    <row id={`canvas-share-${key}`} absolute={{ top: 10, right: 12 }} raise={3} align="center" gap={6} noWindowDrag>
      <Popover
        id={`canvas-share-link-${key}`}
        open={shareOpen}
        onOpenChange={setShareOpen}
        side="bottom"
        align="end"
        sideOffset={8}
        width={320}
        trigger={({ id, open, toggle }) => <PillButton id={id} icon={Icons.stella.Globe} text={t(isPublic ? "shell.display.canvasShare.public" : "shell.display.canvasShare.share")} primary open={open} onPress={toggle} />}
      >
        {shareOpen ? <CanvasLinkPanel item={item} /> : null}
      </Popover>
      <Popover
        id={`canvas-share-links-${key}`}
        open={linksOpen}
        onOpenChange={setLinksOpen}
        side="bottom"
        align="end"
        sideOffset={8}
        width={360}
        trigger={({ id, open, toggle }) => <PillButton id={id} icon={Icons.stella.Link} label={t("shell.display.canvasShare.sharedLinks")} iconOnly open={open} onPress={toggle} />}
      >
        {linksOpen ? <SharedLinksPanel /> : null}
      </Popover>
    </row>
  );
};
