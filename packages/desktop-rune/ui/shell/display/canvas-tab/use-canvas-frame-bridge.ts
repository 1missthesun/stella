import { useCallback, useEffect, useRef } from "react";
import { cleanCanvasActionFields, isCanvasBridgeAction, type CanvasAction, type CanvasActionEvent } from "@stella/contracts/canvas-actions";
import { resolveCanvasLink, type CanvasDocumentLocation, type CanvasLink } from "@stella/contracts/canvas-links";
import { sendCanvasActionToChat, type CanvasActionOutcome, type CanvasIdentity } from "@/shell/display/canvas-tab/use-canvas-actions";
import { openCanvasLink } from "@/shell/display/canvas-tab/open-canvas-link";
import { useViewerWindow } from "@/shell/workspace-stage/viewer-item-context";
import type { CanvasFrameHost } from "./CanvasFrame";

const OPENS_IN_STELLA: ReadonlySet<CanvasLink["kind"]> = new Set(["web", "drive", "device", "app"]);

const activationLapsed = (viewerWindow: Window): boolean => {
  const activation = (viewerWindow.navigator as Navigator & { userActivation?: { isActive: boolean } }).userActivation;
  return activation ? !activation.isActive : false;
};

/** desktop-ui's `useCanvasActions` over the frame's port: declared actions go to chat, the outcome back to the page. */
export function useCanvasActions(args: {
  actions: readonly CanvasAction[] | undefined;
  identity: CanvasIdentity;
  data?: unknown;
  onAction?: (event: CanvasActionEvent) => Promise<CanvasActionOutcome | undefined> | CanvasActionOutcome | undefined;
}): { onFrameLoad: (host: CanvasFrameHost) => void } {
  const portRef = useRef<{ post: (data: unknown) => void; close: () => void } | null>(null);
  const viewerWindow = useViewerWindow();
  const latest = useRef({ ...args, viewerWindow });
  latest.current = { ...args, viewerWindow };

  const post = useCallback((message: unknown) => portRef.current?.post(message), []);

  const handle = useCallback(
    async (message: unknown) => {
      if (!isCanvasBridgeAction(message)) return;
      const { actions, identity, onAction, viewerWindow } = latest.current;
      const declared = actions?.find((action) => action.id === message.id);
      if (!declared || activationLapsed(viewerWindow)) {
        if (!declared) console.warn(`Stella canvas: "${message.id}" is not one of this canvas's declared actions.`);
        post({ type: "state", id: message.id, state: "refused" });
        return;
      }
      const fields = cleanCanvasActionFields(message.fields);
      const event: CanvasActionEvent = { canvas: identity.canvas, title: identity.title, id: declared.id, label: declared.label, ...(fields ? { fields } : {}) };
      let outcome: CanvasActionOutcome;
      try {
        outcome = (onAction ? await onAction(event) : undefined) ?? ((await sendCanvasActionToChat(event)) ? "sent" : "failed");
      } catch {
        outcome = "failed";
      }
      post({ type: "state", id: declared.id, state: outcome });
    },
    [post],
  );

  const onFrameLoad = useCallback(
    (host: CanvasFrameHost) => {
      portRef.current?.close();
      portRef.current = host.openPort((data) => void handle(data));
      if (latest.current.data !== undefined) post({ type: "data", data: latest.current.data });
    },
    [handle, post],
  );

  useEffect(() => {
    if (args.data !== undefined) post({ type: "data", data: args.data });
  }, [args.data, post]);

  useEffect(
    () => () => {
      portRef.current?.close();
      portRef.current = null;
    },
    [],
  );

  return { onFrameLoad };
}

/** desktop-ui's `useCanvasLinks`: a link the user clicks in the canvas opens in Stella, or scrolls within it. */
export function useCanvasLinks(location: CanvasDocumentLocation | null): (data: { type?: unknown; [key: string]: unknown }, host: CanvasFrameHost) => void {
  const viewerWindow = useViewerWindow();
  const locationRef = useRef(location);
  locationRef.current = location;
  return useCallback(
    (data, host) => {
      const href = data.type === "stella:canvas-link" && typeof data.href === "string" ? data.href : data.type === "stella:canvas-open-external" && typeof data.url === "string" ? data.url : null;
      if (href === null || activationLapsed(viewerWindow)) return;
      const link = resolveCanvasLink(href, locationRef.current);
      if (link.kind === "fragment") {
        host.post({ type: "stella:canvas-scroll", fragment: link.fragment });
        return;
      }
      openCanvasLink(link);
      if (viewerWindow !== window && OPENS_IN_STELLA.has(link.kind)) window.electronAPI?.window?.show?.();
    },
    [viewerWindow],
  );
}
