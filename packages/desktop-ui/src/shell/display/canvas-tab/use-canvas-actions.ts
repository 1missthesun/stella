import { useCallback, useEffect, useRef } from "react";
import {
  canvasActionMessage,
  cleanCanvasActionFields,
  isCanvasBridgeAction,
  type CanvasAction,
  type CanvasActionEvent,
} from "@stella/contracts/canvas-actions";
import { useViewerWindow } from "@/shell/workspace-stage/viewer-item-context";
import { STELLA_SEND_MESSAGE_EVENT } from "@/shared/lib/stella-send-message";

export type CanvasIdentity = { canvas: string; title: string };

export type CanvasActionOutcome = "sent" | "refused" | "failed";

export const sendCanvasActionToChat = (event: CanvasActionEvent): Promise<boolean> =>
  new Promise((resolve) => {
    let settled = false;
    const done = (accepted: boolean) => {
      if (settled) return;
      settled = true;
      resolve(accepted);
    };
    window.dispatchEvent(
      new CustomEvent(STELLA_SEND_MESSAGE_EVENT, {
        detail: { text: canvasActionMessage(event), onResult: done },
      }),
    );
    window.setTimeout(() => done(false), 15_000);
  });

const userActivationLapsed = (viewerWindow: Window): boolean => {
  const activation = (viewerWindow.navigator as Navigator & { userActivation?: { isActive: boolean } })
    .userActivation;
  return activation ? !activation.isActive : false;
};

export function useCanvasActions(args: {
  frame: () => HTMLIFrameElement | null;
  actions: readonly CanvasAction[] | undefined;
  identity: CanvasIdentity;
  data?: unknown;
  onAction?: (
    event: CanvasActionEvent,
  ) => Promise<CanvasActionOutcome | undefined> | CanvasActionOutcome | undefined;
}): { onFrameLoad: () => void } {
  const portRef = useRef<MessagePort | null>(null);
  const viewerWindow = useViewerWindow();
  const latest = useRef({ ...args, viewerWindow });
  latest.current = { ...args, viewerWindow };

  const post = useCallback((message: unknown) => {
    try {
      portRef.current?.postMessage(message);
    } catch {}
  }, []);

  const handle = useCallback(
    async (message: unknown) => {
      if (!isCanvasBridgeAction(message)) return;
      const { actions, identity, onAction, viewerWindow } = latest.current;
      const declared = actions?.find((action) => action.id === message.id);
      if (!declared || userActivationLapsed(viewerWindow)) {
        if (!declared) console.warn(`Stella canvas: "${message.id}" is not one of this canvas's declared actions.`);
        post({ type: "state", id: message.id, state: "refused" });
        return;
      }
      const fields = cleanCanvasActionFields(message.fields);
      const event: CanvasActionEvent = {
        canvas: identity.canvas,
        title: identity.title,
        id: declared.id,
        label: declared.label,
        ...(fields ? { fields } : {}),
      };
      let outcome: CanvasActionOutcome;
      try {
        outcome =
          (onAction ? await onAction(event) : undefined) ??
          ((await sendCanvasActionToChat(event)) ? "sent" : "failed");
      } catch {
        outcome = "failed";
      }
      post({ type: "state", id: declared.id, state: outcome });
    },
    [post],
  );

  const onFrameLoad = useCallback(() => {
    portRef.current?.close();
    portRef.current = null;
    const target = latest.current.frame()?.contentWindow;
    if (!target) return;
    const channel = new MessageChannel();
    channel.port1.onmessage = (event) => void handle(event.data);
    portRef.current = channel.port1;
    target.postMessage({ type: "stella:canvas-port" }, "*", [channel.port2]);
    if (latest.current.data !== undefined) post({ type: "data", data: latest.current.data });
  }, [handle, post]);

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
