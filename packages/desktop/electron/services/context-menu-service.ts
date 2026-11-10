import {
  BrowserWindow,
  Menu,
  clipboard,
  ipcMain,
  shell,
  type ContextMenuParams,
  type IpcMainEvent,
  type MenuItemConstructorOptions,
  type WebContents,
} from "electron";
import type {
  ContextMenuCollectReply,
  ContextMenuWireItem,
} from "@stella/contracts/desktop/context-menu";
import {
  IPC_CONTEXT_MENU_COLLECT,
  IPC_CONTEXT_MENU_ITEMS,
  IPC_CONTEXT_MENU_SELECT,
} from "@stella/contracts/desktop/ipc-channels";
import { t } from "./i18n-service.js";

/**
 * Native right-click menus for every surface. One mechanism everywhere: the
 * OS draws the menu (so it never clips, works from the keyboard and follows
 * the platform), main adds what only Chromium knows (spelling, whether
 * cut/copy/paste apply), and Stella's own UI says what the clicked thing
 * offers. Web pages in Stella's browser get the standard page menu.
 */

/** How long a right-click waits for the UI to say what it offers. */
const REPLY_TIMEOUT_MS = 350;
const MAX_ITEMS = 80;
const MAX_LABEL = 160;
const MAX_SUGGESTIONS = 6;

type Section = MenuItemConstructorOptions[];

export type BrowserTabMenuHooks = {
  window: () => BrowserWindow | null;
  openInNewTab: (url: string) => void;
  search: (text: string) => void;
};

type Pending = {
  contents: WebContents;
  resolve: (reply: ContextMenuCollectReply | null) => void;
  timer: ReturnType<typeof setTimeout>;
};

const pending = new Map<number, Pending>();
let nextRequestId = 1;
let listening = false;

const isMac = process.platform === "darwin";

const quoted = (text: string): string => {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length > 28 ? `${flat.slice(0, 27)}…` : flat;
};

const httpUrl = (value: string): string | null => {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:"
      ? url.href
      : null;
  } catch {
    return null;
  }
};

const sanitizeItems = (
  value: unknown,
  depth: number,
  budget: { left: number },
): ContextMenuWireItem[] => {
  if (!Array.isArray(value)) return [];
  const items: ContextMenuWireItem[] = [];
  for (const raw of value) {
    if (budget.left <= 0) break;
    if (!raw || typeof raw !== "object") continue;
    const item = raw as Record<string, unknown>;
    if (item.type === "separator") {
      items.push({ type: "separator" });
      continue;
    }
    const label =
      typeof item.label === "string" ? item.label.slice(0, MAX_LABEL) : "";
    if (!label) continue;
    budget.left -= 1;
    if (item.type === "submenu" && depth < 2) {
      items.push({
        type: "submenu",
        label,
        enabled: item.enabled !== false,
        items: sanitizeItems(item.items, depth + 1, budget),
      });
      continue;
    }
    if (item.type !== "action" || typeof item.id !== "string") continue;
    items.push({
      type: "action",
      id: item.id,
      label,
      enabled: item.enabled !== false,
      ...(typeof item.checked === "boolean" ? { checked: item.checked } : {}),
    });
  }
  return items;
};

const sanitizeReply = (value: unknown): ContextMenuCollectReply | null => {
  if (!value || typeof value !== "object") return null;
  const reply = value as Record<string, unknown>;
  if (typeof reply.requestId !== "number") return null;
  const budget = { left: MAX_ITEMS };
  return {
    requestId: reply.requestId,
    selection: sanitizeItems(reply.selection, 0, budget),
    sections: Array.isArray(reply.sections)
      ? reply.sections
          .map((section) => sanitizeItems(section, 0, budget))
          .filter((section) => section.length > 0)
      : [],
    ignoreSelection: reply.ignoreSelection === true,
  };
};

const ensureReplyListener = () => {
  if (listening) return;
  listening = true;
  ipcMain.on(IPC_CONTEXT_MENU_ITEMS, (event: IpcMainEvent, raw: unknown) => {
    const reply = sanitizeReply(raw);
    if (!reply) return;
    const entry = pending.get(reply.requestId);
    if (!entry || entry.contents !== event.sender) return;
    pending.delete(reply.requestId);
    clearTimeout(entry.timer);
    entry.resolve(reply);
  });
};

const askRenderer = (
  contents: WebContents,
  params: ContextMenuParams,
): Promise<{ requestId: number; reply: ContextMenuCollectReply | null }> => {
  ensureReplyListener();
  const requestId = nextRequestId++;
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      pending.delete(requestId);
      resolve({ requestId, reply: null });
    }, REPLY_TIMEOUT_MS);
    pending.set(requestId, {
      contents,
      timer,
      resolve: (reply) => resolve({ requestId, reply }),
    });
    contents.send(IPC_CONTEXT_MENU_COLLECT, {
      requestId,
      x: params.x,
      y: params.y,
      selectionText: params.selectionText ?? "",
      isEditable: Boolean(params.isEditable),
      linkURL: params.linkURL ?? "",
      mediaType: params.mediaType ?? "none",
      srcURL: params.srcURL ?? "",
    });
  });
};

const fromWire = (
  items: ContextMenuWireItem[],
  pick: (id: string) => void,
): Section =>
  items.map((item): MenuItemConstructorOptions => {
    if (item.type === "separator") return { type: "separator" };
    if (item.type === "submenu") {
      return {
        label: item.label,
        enabled: item.enabled !== false,
        submenu: fromWire(item.items, pick),
      };
    }
    return {
      label: item.label,
      enabled: item.enabled !== false,
      ...(typeof item.checked === "boolean"
        ? { type: "checkbox" as const, checked: item.checked }
        : {}),
      click: () => pick(item.id),
    };
  });

const shortcut = (accelerator: string) => ({
  accelerator,
  registerAccelerator: false,
});

const spellingSection = (
  contents: WebContents,
  params: ContextMenuParams,
): Section => {
  if (!params.isEditable || !params.misspelledWord) return [];
  const word = params.misspelledWord;
  const suggestions = (params.dictionarySuggestions ?? []).slice(
    0,
    MAX_SUGGESTIONS,
  );
  return [
    ...(suggestions.length > 0
      ? suggestions.map(
          (suggestion): MenuItemConstructorOptions => ({
            label: suggestion,
            click: () => contents.replaceMisspelling(suggestion),
          }),
        )
      : [{ label: t("contextMenu.noGuesses"), enabled: false }]),
    { type: "separator" },
    {
      label: isMac
        ? t("contextMenu.learnSpelling")
        : t("contextMenu.addToDictionary"),
      click: () => contents.session.addWordToSpellCheckerDictionary(word),
    },
  ];
};

const editSection = (
  contents: WebContents,
  params: ContextMenuParams,
): Section => {
  const flags = params.editFlags;
  return [
    {
      label: t("contextMenu.cut"),
      enabled: flags.canCut,
      click: () => contents.cut(),
      ...shortcut("CommandOrControl+X"),
    },
    {
      label: t("contextMenu.copy"),
      enabled: flags.canCopy,
      click: () => contents.copy(),
      ...shortcut("CommandOrControl+C"),
    },
    {
      label: t("contextMenu.paste"),
      enabled: flags.canPaste,
      click: () => contents.paste(),
      ...shortcut("CommandOrControl+V"),
    },
    {
      label: isMac
        ? t("contextMenu.pasteAndMatchStyle")
        : t("contextMenu.pastePlainText"),
      enabled: flags.canPaste,
      click: () => contents.pasteAndMatchStyle(),
      ...shortcut(isMac ? "Alt+Shift+Command+V" : "Control+Shift+V"),
    },
    { type: "separator" },
    {
      label: t("contextMenu.selectAll"),
      enabled: flags.canSelectAll,
      click: () => contents.selectAll(),
      ...shortcut("CommandOrControl+A"),
    },
  ];
};

const selectionSection = (
  contents: WebContents,
  params: ContextMenuParams,
): Section => [
  {
    label: t("contextMenu.copy"),
    click: () => contents.copy(),
    ...shortcut("CommandOrControl+C"),
  },
  ...(isMac
    ? [
        {
          label: t("contextMenu.lookUp", {
            text: quoted(params.selectionText),
          }),
          click: () => contents.showDefinitionForSelection(),
        },
      ]
    : []),
];

/** What a plain web page offers: its links, images and history. */
const pageSections = (
  contents: WebContents,
  params: ContextMenuParams,
  browser: BrowserTabMenuHooks | undefined,
): Section[] => {
  const sections: Section[] = [];
  const link = httpUrl(params.linkURL ?? "");
  if (link) {
    sections.push([
      ...(browser
        ? [
            {
              label: t("contextMenu.openLinkInNewTab"),
              click: () => browser.openInNewTab(link),
            },
          ]
        : []),
      {
        label: t("contextMenu.openInYourBrowser"),
        click: () => void shell.openExternal(link),
      },
      {
        label: t("contextMenu.copyLink"),
        click: () => clipboard.writeText(link),
      },
    ]);
  }
  if (params.mediaType === "image" && params.srcURL) {
    const src = params.srcURL;
    sections.push([
      {
        label: t("contextMenu.copyImage"),
        click: () => contents.copyImageAt(params.x, params.y),
      },
      ...(httpUrl(src)
        ? [
            {
              label: t("contextMenu.copyImageAddress"),
              click: () => clipboard.writeText(src),
            },
          ]
        : []),
    ]);
  }
  if (
    browser &&
    params.selectionText.trim() &&
    !params.isEditable
  ) {
    const text = params.selectionText.trim();
    sections.unshift([
      {
        label: t("contextMenu.searchGoogle", { text: quoted(text) }),
        click: () => browser.search(text),
      },
    ]);
  }
  if (browser && !link && !params.isEditable && !params.selectionText.trim()) {
    const history = contents.navigationHistory;
    sections.push([
      {
        label: t("contextMenu.back"),
        enabled: history.canGoBack(),
        click: () => history.goBack(),
      },
      {
        label: t("contextMenu.forward"),
        enabled: history.canGoForward(),
        click: () => history.goForward(),
      },
      { label: t("contextMenu.reload"), click: () => contents.reload() },
    ]);
  }
  return sections;
};

const join = (sections: Section[]): Section => {
  const items: Section = [];
  for (const section of sections) {
    if (section.length === 0) continue;
    if (items.length > 0) items.push({ type: "separator" });
    items.push(...section);
  }
  return items;
};

const isMainFrame = (contents: WebContents, params: ContextMenuParams) => {
  const frame = params.frame;
  if (!frame) return true;
  try {
    return frame === contents.mainFrame || frame.parent === null;
  } catch {
    return false;
  }
};

const showMenu = async (
  contents: WebContents,
  params: ContextMenuParams,
  options: { askRenderer: boolean; browser?: BrowserTabMenuHooks },
) => {
  const fromApp = options.askRenderer && isMainFrame(contents, params);
  const asked = fromApp ? await askRenderer(contents, params) : null;
  if (contents.isDestroyed()) return;
  const reply = asked?.reply ?? null;
  const pick = (id: string) => {
    if (!asked || contents.isDestroyed()) return;
    contents.send(IPC_CONTEXT_MENU_SELECT, {
      requestId: asked.requestId,
      itemId: id,
    });
  };
  const selection = params.selectionText.trim();
  // macOS selects the word under a right-click; on a link that word is just
  // the link's own text, and the link's menu is what was asked for.
  const selected =
    !params.isEditable &&
    selection.length > 0 &&
    !reply?.ignoreSelection &&
    !(params.linkURL && selection === (params.linkText ?? "").trim());
  const sections: Section[] = [
    spellingSection(contents, params),
    params.isEditable ? editSection(contents, params) : [],
    selected
      ? [
          ...selectionSection(contents, params),
          ...fromWire(reply?.selection ?? [], pick),
        ]
      : [],
    ...(reply?.sections ?? []).map((section) => fromWire(section, pick)),
    ...(fromApp ? [] : pageSections(contents, params, options.browser)),
  ];
  const template = join(sections);
  if (template.length === 0) return;
  const window =
    options.browser?.window() ?? BrowserWindow.fromWebContents(contents);
  const keyboard = params.menuSourceType === "keyboard" && !options.browser;
  Menu.buildFromTemplate(template).popup({
    ...(window ? { window } : {}),
    ...(keyboard ? { x: Math.round(params.x), y: Math.round(params.y) } : {}),
  });
};

/**
 * Give `contents` right-click menus. `askRenderer` is for Stella's own UI,
 * which says what the clicked thing offers; web pages leave it off.
 */
export const installContextMenu = (
  contents: WebContents,
  options: { askRenderer: boolean; browser?: BrowserTabMenuHooks },
): void => {
  contents.on("context-menu", (_event, params) => {
    void showMenu(contents, params, options).catch((error: unknown) => {
      console.warn(
        "[context-menu] could not show the menu:",
        error instanceof Error ? error.message : String(error),
      );
    });
  });
};
