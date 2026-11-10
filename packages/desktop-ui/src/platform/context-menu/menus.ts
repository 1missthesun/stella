import {
  driveLinkPath,
  isCloudWorkspacePath,
} from "@stella/contracts/cloud-world-paths";
import { attachmentContentType } from "@stella/contracts/attachment-content-type";
import type { ChatContext } from "@/shared/types/electron";
import { translateNow as t } from "@/shared/i18n";
import { copyTextToClipboard } from "@/shared/lib/clipboard";
import { copyImageBlob } from "@/shell/media-clipboard";
import {
  normalizedHttpUrl,
  openUrlInStellaBrowser,
} from "@/features/chat/lib/stella-web-links";
import { sidebarSections } from "@/features/workspace-display/sidebar-sections";
import { showToast } from "@/ui/toast";
import {
  registerContextMenu,
  type MenuAction,
  type MenuContext,
  type MenuSection,
} from "./context-menu";

/* ------------------------------------------------------------------ */
/* Platform words                                                      */
/* ------------------------------------------------------------------ */

const platform = (): string =>
  window.electronAPI?.platform ??
  (/Mac/i.test(navigator.platform) ? "darwin" : "linux");

/** "Show in Finder", "Show in File Explorer", "Open containing folder". */
export const revealLabel = (): string => {
  const os = platform();
  if (os === "darwin") return t("contextMenu.showInFinder");
  if (os === "win32") return t("contextMenu.showInExplorer");
  return t("contextMenu.showInFolder");
};

const nameOf = (path: string): string => path.split(/[\\/]/).pop() || path;

const quoted = (text: string): string => {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length > 28 ? `${flat.slice(0, 27)}…` : flat;
};

/* ------------------------------------------------------------------ */
/* Composer: what "Add to chat" reaches                                */
/* ------------------------------------------------------------------ */

type ComposerBridge = {
  setChatContext: (update: (prev: ChatContext | null) => ChatContext | null) => void;
  quote: (text: string) => void;
  focus: () => void;
};

let composer: ComposerBridge | null = null;

/** The chat registers its composer so menus can add things to it. */
export const setContextMenuComposer = (next: ComposerBridge | null): void => {
  composer = next;
};

export const canAddToChat = (): boolean => composer !== null;

/** Attach a file on this computer to the next message, by reference. */
export const attachPathToChat = async (path: string): Promise<void> => {
  if (!composer) return;
  const stat = await window.electronAPI?.display
    ?.statPath(path)
    .catch(() => null);
  const name = nameOf(path);
  composer.setChatContext((prev) => {
    const base = prev ?? { window: null };
    const files = base.files ?? [];
    if (files.some((file) => file.path === path)) return base;
    return {
      ...base,
      files: [
        ...files,
        {
          name,
          size: stat?.sizeBytes ?? 0,
          mimeType:
            stat?.mimeType || attachmentContentType({ declared: "", name }),
          dataUrl: "",
          path,
        },
      ],
    };
  });
  composer.focus();
};

/** Quote text in the composer, as Reply and "Ask Stella" do. */
export const quoteInChat = (text: string): void => {
  const value = text.trim();
  if (!value || !composer) return;
  composer.quote(value);
  composer.focus();
};

/* ------------------------------------------------------------------ */
/* Actions                                                             */
/* ------------------------------------------------------------------ */

const failed = (error?: string) =>
  showToast({
    description: error || t("contextMenu.failed"),
    variant: "error",
  });

export const copyText = async (text: string): Promise<void> => {
  if (!(await copyTextToClipboard(text))) failed();
};

const readBlob = async (path: string): Promise<Blob | null> => {
  const read = await window.electronAPI?.display?.readFile?.(path, {
    conversationId: null,
  });
  if (!read || read.missing) return null;
  const bytes = read.bytes;
  const part =
    bytes.buffer instanceof ArrayBuffer
      ? (bytes as Uint8Array<ArrayBuffer>)
      : new Uint8Array(bytes);
  return new Blob([part], { type: read.mimeType || "image/png" });
};

/** Copy the image at `path` (a file) or `src` (any URL the page can load). */
export const copyImage = async (source: {
  path?: string;
  src?: string;
}): Promise<void> => {
  try {
    const blob = source.path
      ? await readBlob(source.path)
      : source.src
        ? await fetch(source.src).then((response) => response.blob())
        : null;
    if (!blob) throw new Error();
    await copyImageBlob(blob);
  } catch (error) {
    failed(error instanceof Error ? error.message : undefined);
  }
};

const openWithDefaultApp = async (path: string): Promise<void> => {
  const result = await window.electronAPI?.system?.openPath?.(path);
  if (result && !result.ok) failed(result.error);
};

const saveAs = async (path: string): Promise<void> => {
  const result = await window.electronAPI?.system?.saveFileAs?.(
    path,
    nameOf(path),
  );
  if (result && !result.canceled && !result.ok) failed(result.error);
};

const reveal = (path: string): void => {
  window.electronAPI?.system?.showItemInFolder?.(path);
};

export const openInStellaBrowser = async (url: string): Promise<void> => {
  const api = window.electronAPI?.browserView;
  const opened = api
    ? await openUrlInStellaBrowser(url, api).catch(() => false)
    : false;
  if (!opened) window.electronAPI?.system?.openExternal?.(url);
};

/* ------------------------------------------------------------------ */
/* Groups                                                              */
/* ------------------------------------------------------------------ */

export type FileMenuOptions = {
  /** What a plain click does; the menu's first item. */
  open?: () => void;
  /** Offer Copy image. */
  image?: boolean;
  /** Overrides plain "Add to chat" (the viewer toggles its own chip). */
  addToChat?: MenuAction | null;
};

type Presence = "here" | "missing" | "elsewhere";

const PRESENCE_TIMEOUT_MS = 200;

const presenceOf = async (path: string): Promise<Presence> => {
  if (driveLinkPath(path) || isCloudWorkspacePath(path)) return "elsewhere";
  const statPath = window.electronAPI?.display?.statPath;
  if (!statPath) return "elsewhere";
  const check = statPath(path).then(
    (stat): Presence => (stat.deviceId || stat.deviceName ? "elsewhere" : "here"),
    (): Presence => "missing",
  );
  // A file on this computer answers at once; a slow answer means Stella is
  // asking other computers, and the menu can't wait for them.
  const slow = new Promise<Presence>((resolve) =>
    window.setTimeout(() => resolve("elsewhere"), PRESENCE_TIMEOUT_MS),
  );
  return await Promise.race([check, slow]);
};

/**
 * A file's actions: open it, copy it, find it on disk, keep a copy, put it in
 * the chat. Checks the file is still there, and says so when it isn't.
 */
export const fileMenu =
  (path: string, options: FileMenuOptions = {}) =>
  async (): Promise<MenuSection[]> => {
    const presence = await presenceOf(path);
    const here = presence === "here";
    const sections: MenuSection[] = [];
    if (options.open) {
      sections.push([{ label: t("contextMenu.open"), run: options.open }]);
    }
    if (presence === "missing") {
      sections.push([
        { label: t("contextMenu.fileMissing"), run: () => {}, enabled: false },
        { label: t("contextMenu.copyPath"), run: () => copyText(path) },
      ]);
      return sections;
    }
    if (options.image && here) {
      sections.push([
        { label: t("contextMenu.copyImage"), run: () => copyImage({ path }) },
      ]);
    }
    if (here) {
      sections.push([
        {
          label: t("contextMenu.openWithDefaultApp"),
          run: () => openWithDefaultApp(path),
        },
        { label: revealLabel(), run: () => reveal(path) },
        { label: t("contextMenu.copyPath"), run: () => copyText(path) },
      ]);
      const keep: MenuSection = [
        { label: t("contextMenu.saveAs"), run: () => saveAs(path) },
      ];
      const add =
        options.addToChat === undefined
          ? canAddToChat()
            ? { label: t("contextMenu.addToChat"), run: () => attachPathToChat(path) }
            : null
          : options.addToChat;
      if (add) keep.push(add);
      sections.push(keep);
    } else if (!driveLinkPath(path)) {
      sections.push([
        { label: t("contextMenu.copyPath"), run: () => copyText(path) },
      ]);
    }
    return sections;
  };

/** A web address: Stella's browser by default, or the system's. */
export const linkMenu = (url: string): MenuSection => [
  { label: t("contextMenu.open"), run: () => openInStellaBrowser(url) },
  {
    label: t("contextMenu.openInYourBrowser"),
    run: () => window.electronAPI?.system?.openExternal?.(url),
  },
  { label: t("contextMenu.copyLink"), run: () => copyText(url) },
];

/* ------------------------------------------------------------------ */
/* Everywhere                                                          */
/* ------------------------------------------------------------------ */

const selectionGroup = ({ selectionText, isEditable }: MenuContext) => {
  const text = selectionText.trim();
  if (!text || isEditable) return null;
  const section: MenuSection = [];
  if (canAddToChat()) {
    section.push({
      label: t("contextMenu.addToChat"),
      run: () => quoteInChat(text),
    });
  }
  section.push({
    label: t("contextMenu.searchGoogle", { text: quoted(text) }),
    run: () =>
      openInStellaBrowser(
        `https://www.google.com/search?q=${encodeURIComponent(text)}`,
      ),
  });
  return section;
};

const linkGroup = ({ target, claimed }: MenuContext) => {
  if (claimed.has("link")) return null;
  const anchor = target.closest<HTMLAnchorElement>("a[href]");
  const url = anchor ? normalizedHttpUrl(anchor.href) : null;
  return url ? linkMenu(url) : null;
};

const codeGroup = ({ target, claimed }: MenuContext) => {
  if (claimed.has("code")) return null;
  const block = target.closest<HTMLElement>(
    "[data-streamdown='code-block'], pre",
  );
  if (!block) return null;
  const pre = block.querySelector<HTMLElement>("pre") ?? block;
  // innerText keeps line breaks between highlighted lines.
  const text = (pre.querySelector<HTMLElement>("code") ?? pre).innerText ?? "";
  if (!text.trim()) return null;
  return [{ label: t("contextMenu.copyCode"), run: () => copyText(text) }];
};

const imageGroup = ({ target, claimed }: MenuContext) => {
  if (claimed.has("image")) return null;
  const image = target.closest("img");
  const src = image?.currentSrc || image?.src;
  if (!image || !src || image.closest("[aria-hidden='true']")) return null;
  return [{ label: t("contextMenu.copyImage"), run: () => copyImage({ src }) }];
};

const tabGroup = ({ target }: MenuContext) => {
  const tab = target.closest<HTMLElement>(".topbar-tabs [data-tab-id]");
  const tabId = tab?.dataset.tabId;
  if (!tabId) return null;
  const others = sidebarSections
    .getSnapshot()
    .tabs.filter((entry) => entry.id !== tabId);
  return [
    {
      label: t("contextMenu.closeTab"),
      run: () => sidebarSections.closeTab(tabId),
    },
    {
      label: t("contextMenu.closeOtherTabs"),
      enabled: others.length > 0,
      run: () => {
        for (const entry of others) sidebarSections.closeTab(entry.id);
      },
    },
  ];
};

/**
 * Menus that apply wherever their target turns up. Calling it again (a
 * newer copy of this code after a warm swap) replaces them.
 */
export const registerSharedMenus = (): void => {
  registerContextMenu("selection", selectionGroup, { slot: "selection" });
  registerContextMenu("tab", tabGroup);
  registerContextMenu("link", linkGroup);
  registerContextMenu("code", codeGroup);
  registerContextMenu("image", imageGroup);
};
