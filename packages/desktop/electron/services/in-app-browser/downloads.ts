import { randomUUID } from "node:crypto";
import { appendFile, mkdir } from "node:fs/promises";
import { existsSync, mkdirSync } from "node:fs";
import path from "node:path";
import {
  BrowserWindow,
  type DownloadItem,
  type Event,
  type Session,
  type WebContents,
} from "electron";
import {
  IN_APP_BROWSER_DOWNLOADS_INDEX,
  inAppBrowserDownloadsSegments,
  type InAppBrowserDownloadRecord,
  type InAppBrowserDownloadState,
} from "@stella/contracts/in-app-browser-downloads";
import type { InAppBrowserDebuggerEvent } from "../in-app-browser-cdp-adapter.js";
import { MANUAL_OWNER_ID, type ManagedTab } from "./tab-registry.js";

type InAppBrowserDownloadsOptions = {
  stellaDataDir: string;
  getUserDownloadsDir: () => string;
  findTab: (contents: WebContents) => ManagedTab | undefined;
  emit: (event: InAppBrowserDebuggerEvent) => void;
};

const MAX_FILENAME_LENGTH = 180;

const safeFilename = (raw: string) => {
  const base = path
    .basename(raw.replace(/\\/g, "/"))
    .replace(/[\u0000-\u001f<>:"/\\|?*]+/g, "_")
    .replace(/^\.+/, "")
    .trim();
  if (!base) return "download";
  if (base.length <= MAX_FILENAME_LENGTH) return base;
  const extension = path.extname(base).slice(0, 20);
  return base.slice(0, MAX_FILENAME_LENGTH - extension.length) + extension;
};

/**
 * A save dialog takes the window that hosts the tab as its parent. Agent tabs
 * live in windows that are never shown, and on Wayland a dialog parented to an
 * unmapped window is a protocol error that aborts the whole app, so only a tab
 * in a visible window gets the dialog. Everything else is saved directly:
 * agent tabs into their own folder (reported to the agent), other tabs into
 * the user's Downloads.
 */
export class InAppBrowserDownloads {
  private readonly options: InAppBrowserDownloadsOptions;
  private readonly sessions = new WeakSet<Session>();
  private readonly reservedPaths = new Set<string>();

  constructor(options: InAppBrowserDownloadsOptions) {
    this.options = options;
  }

  watch(browserSession: Session) {
    if (this.sessions.has(browserSession)) return;
    this.sessions.add(browserSession);
    browserSession.on("will-download", this.onWillDownload);
  }

  agentDownloadsDir(ownerId: string) {
    return path.join(
      this.options.stellaDataDir,
      ...inAppBrowserDownloadsSegments(ownerId),
    );
  }

  private readonly onWillDownload = (
    _event: Event,
    item: DownloadItem,
    contents: WebContents | undefined,
  ) => {
    const tab =
      contents && !contents.isDestroyed()
        ? this.options.findTab(contents)
        : undefined;
    const agentTab = tab && tab.ownerId !== MANUAL_OWNER_ID ? tab : undefined;
    if (!agentTab && contents && this.hasVisibleParent(contents, tab)) return;
    const directory = agentTab
      ? this.agentDownloadsDir(agentTab.ownerId)
      : this.options.getUserDownloadsDir();
    let savePath: string;
    try {
      mkdirSync(directory, { recursive: true });
      savePath = this.reservePath(directory, item.getFilename());
      item.setSavePath(savePath);
    } catch {
      item.cancel();
      return;
    }
    const id = randomUUID();
    const startedAt = Date.now();
    item.once("done", (_doneEvent, state) => {
      this.reservedPaths.delete(savePath);
      if (agentTab) {
        this.finishAgentDownload(agentTab, item, { id, savePath, startedAt, state });
      }
    });
    if (!agentTab) return;
    this.options.emit({
      tabId: agentTab.id,
      method: "Browser.downloadWillBegin",
      params: {
        frameId: "",
        guid: id,
        url: item.getURL(),
        suggestedFilename: path.basename(savePath),
      },
    });
  };

  private hasVisibleParent(contents: WebContents, tab: ManagedTab | undefined) {
    if (tab?.offscreen) return false;
    const window = BrowserWindow.fromWebContents(contents);
    return !!window && !window.isDestroyed() && window.isVisible();
  }

  private reservePath(directory: string, suggested: string) {
    const filename = safeFilename(suggested);
    const extension = path.extname(filename);
    const stem = filename.slice(0, filename.length - extension.length);
    for (let index = 0; index < 10_000; index += 1) {
      const candidate = path.join(
        directory,
        index === 0 ? filename : `${stem} (${index})${extension}`,
      );
      if (this.reservedPaths.has(candidate) || existsSync(candidate)) continue;
      this.reservedPaths.add(candidate);
      return candidate;
    }
    throw new Error("No free download filename.");
  }

  private finishAgentDownload(
    tab: ManagedTab,
    item: DownloadItem,
    download: {
      id: string;
      savePath: string;
      startedAt: number;
      state: "completed" | "cancelled" | "interrupted";
    },
  ) {
    const state: InAppBrowserDownloadState = download.state;
    const record: InAppBrowserDownloadRecord = {
      id: download.id,
      path: download.savePath,
      filename: path.basename(download.savePath),
      url: item.getURL(),
      mimeType: item.getMimeType(),
      state,
      receivedBytes: item.getReceivedBytes(),
      totalBytes: item.getTotalBytes(),
      startedAt: download.startedAt,
      finishedAt: Date.now(),
    };
    this.options.emit({
      tabId: tab.id,
      method: "Browser.downloadProgress",
      params: {
        guid: record.id,
        totalBytes: record.totalBytes,
        receivedBytes: record.receivedBytes,
        state: state === "completed" ? "completed" : "canceled",
        filePath: record.path,
      },
    });
    const directory = this.agentDownloadsDir(tab.ownerId);
    void mkdir(directory, { recursive: true })
      .then(() =>
        appendFile(
          path.join(directory, IN_APP_BROWSER_DOWNLOADS_INDEX),
          `${JSON.stringify(record)}\n`,
        ),
      )
      .catch(() => undefined);
  }
}
