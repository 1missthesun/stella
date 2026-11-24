import { useCallback, useEffect, useMemo, useRef, type RefObject } from "react";
import type { WebView } from "react-native-webview";
import { getRandomBytes } from "expo-crypto";
import {
  canvasActionMessage,
  cleanCanvasActionFields,
  type CanvasAction,
  type CanvasActionEvent,
} from "@stella/contracts/canvas-actions";
import { sendToChat } from "./chat-send-queue";

export type CanvasActionOutcome = "sent" | "refused" | "failed";
export type CanvasIdentity = { canvas: string; title: string };

const randomName = (): string =>
  Array.from(getRandomBytes(16), (byte) => byte.toString(16).padStart(2, "0")).join("");

export function useCanvasActionChannel(args: {
  webViewRef: RefObject<WebView | null>;
  token: string;
  actions: readonly CanvasAction[] | undefined;
  identity: CanvasIdentity;
  data?: unknown;
  onAction?: (event: CanvasActionEvent) => Promise<CanvasActionOutcome | undefined> | CanvasActionOutcome | undefined;
}): {
  receiverKey: string;
  handleMessage: (message: Record<string, unknown>) => boolean;
  onLoaded: () => void;
} {
  const { token, webViewRef } = args;
  const receiverKey = useMemo(() => `__stellaCanvasReceive_${randomName()}`, [token]);
  const latest = useRef(args);
  latest.current = args;

  const post = useCallback(
    (message: unknown) => {
      webViewRef.current?.injectJavaScript(
        `(() => { const receive = window[${JSON.stringify(receiverKey)}]; if (typeof receive === "function") receive(${JSON.stringify(message)}); })(); true;`,
      );
    },
    [receiverKey, webViewRef],
  );

  const run = useCallback(
    async (id: string, rawFields: unknown) => {
      const { actions, identity, onAction } = latest.current;
      const declared = actions?.find((action) => action.id === id);
      if (!declared) {
        post({ type: "state", id, state: "refused" });
        return;
      }
      const fields = cleanCanvasActionFields(rawFields);
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
          ((await sendToChat(canvasActionMessage(event))) ? "sent" : "failed");
      } catch {
        outcome = "failed";
      }
      post({ type: "state", id: declared.id, state: outcome });
    },
    [post],
  );

  const handleMessage = useCallback(
    (message: Record<string, unknown>) => {
      if (message.type !== "stella:canvas-action") return false;
      if (message.token !== latest.current.token || typeof message.id !== "string") return true;
      void run(message.id, message.fields);
      return true;
    },
    [run],
  );

  const onLoaded = useCallback(() => {
    if (latest.current.data !== undefined) post({ type: "data", data: latest.current.data });
  }, [post]);

  useEffect(() => {
    if (args.data !== undefined) post({ type: "data", data: args.data });
  }, [args.data, post]);

  return { receiverKey, handleMessage, onLoaded };
}
