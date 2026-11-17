import { useCallback, useEffect, useRef } from "react";
import {
  canvasActionMessage,
  cleanCanvasActionFields,
  isCanvasBridgeAction,
  type CanvasAction,
  type CanvasActionEvent,
} from "@stella/contracts/canvas-actions";
import { STELLA_SEND_MESSAGE_EVENT } from "@/shared/lib/stella-send-message";

export type CanvasIdentity = { canvas: string; title: string };

export type CanvasActionOutcome = "sent" | "refused" | "failed";

/** Sends a tap to Stella as a chat message; resolves with whether the chat took it. */
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
    // No chat mounted to take it (signed out, still loading).
    window.setTimeout(() => done(false), 15_000);
  });

const userActivationLapsed = (): boolean => {
  const activation = (navigator as Navigator & { userActivation?: { isActive: boolean } })
    .userActivation;
  return activation ? !activation.isActive : false;
};

/**
 * The host end of a canvas's action channel (see canvas-actions.ts). Call
 * `onFrameLoad` from the iframe's load: it hands the frame's bridge a fresh
 * MessagePort, and from then on only taps on that port count. A tap must
 * name a declared action and arrive while the window still holds the user's
 * activation from the click inside the frame; the label sent is the
 * declaration's, never the page's.
 */
export function useCanvasActions(args: {
  frame: () => HTMLIFrameElement | null;
  actions: readonly CanvasAction[] | undefined;
  identity: CanvasIdentity;
  /** Data fed to a built-in page (`stella:data` inside the frame), re-sent when it changes. */
  data?: unknown;
  /** Handles a tap instead of sending it to the chat; undefined sends it on. */
  onAction?: (
    event: CanvasActionEvent,
  ) => Promise<CanvasActionOutcome | undefined> | CanvasActionOutcome | undefined;
}): { onFrameLoad: () => void } {
  const portRef = useRef<MessagePort | null>(null);
  const latest = useRef(args);
  latest.current = args;

  const post = useCallback((message: unknown) => {
    try {
      portRef.current?.postMessage(message);
    } catch {
      // A port whose frame went away.
    }
  }, []);

  const handle = useCallback(
    async (message: unknown) => {
      if (!isCanvasBridgeAction(message)) return;
      const { actions, identity, onAction } = latest.current;
      const declared = actions?.find((action) => action.id === message.id);
      if (!declared || userActivationLapsed()) {
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
