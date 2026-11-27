// A `<webview html>` on the web. A srcdoc frame would be the chat's own origin (its storage, its
// session) under the chat's script policy, which refuses a page's inline scripts. The page runs in
// the canvas host instead (`canvas-host.html`, built beside index.html): a sandboxed opaque origin
// under the canvas policy, as desktop-ui's web build hosts canvases. The host page asks for its
// HTML once it has loaded and says when it has written it.

import { CANVAS_FRAME_SANDBOX, CANVAS_HOST_FILE, canvasHostMessageType } from "@stella/contracts/canvas-host";

export { CANVAS_FRAME_SANDBOX as HOSTED_SANDBOX };

export const hostedPageUrl = (): string => new URL(CANVAS_HOST_FILE, document.baseURI).href;

const LEADING_PREAMBLE = /^﻿?\s*(?:<!--[\s\S]*?-->\s*)*(?:<!doctype[^>]*>)?/i;

/** The page with `preload` run before its own scripts, as the desktop engine runs a webview's preload. */
export function withPreload(html: string, preload: string | undefined): string {
  if (!preload) return html;
  const preamble = LEADING_PREAMBLE.exec(html)?.[0] ?? "";
  return `${preamble}<script>${preload.replace(/<\/(script)/gi, "<\\/$1")}</script>${html.slice(preamble.length)}`;
}

/** HTML `engine.webview.loadHtml` gave a frame, over its element's own until the element's changes. */
const loaded = new WeakMap<HTMLIFrameElement, string>();

export function loadHostedHtml(frame: HTMLIFrameElement, html: string) {
  loaded.set(frame, html);
  frame.setAttribute("sandbox", CANVAS_FRAME_SANDBOX);
  frame.referrerPolicy = "no-referrer";
  frame.src = hostedPageUrl();
}

export const loadedHtml = (frame: HTMLIFrameElement): string | undefined => loaded.get(frame);
export const clearLoadedHtml = (frame: HTMLIFrameElement) => loaded.delete(frame);

/**
 * Answers the canvas host's own messages from `frame`: the page when it is ready, `onWritten` once
 * the page is in. Returns whether the message was the host's (and so not the page's).
 */
export function answerHost(frame: HTMLIFrameElement, data: unknown, page: () => string, onWritten: () => void): boolean {
  const type = canvasHostMessageType(data);
  if (type === "stella:canvas-host-ready") frame.contentWindow?.postMessage({ type: "stella:canvas-html", html: page() }, "*");
  else if (type === "stella:canvas-written") onWritten();
  return type !== null;
}
