import { useEffect } from "react";
import { useChatRuntime } from "@/context/use-chat-runtime";
import { installContextMenus } from "./context-menu";
import { registerSharedMenus, setContextMenuComposer } from "./menus";

/** Turns on right-click menus and lets them reach the composer. */
export function ContextMenuHost() {
  const { composer } = useChatRuntime();
  const { setChatContext, setSelectedText, requestFocus } = composer;

  useEffect(() => {
    installContextMenus();
    registerSharedMenus();
  }, []);

  useEffect(() => {
    setContextMenuComposer({
      setChatContext: (update) => setChatContext(update),
      quote: (text) => setSelectedText(text),
      focus: () => requestFocus?.(),
    });
    return () => setContextMenuComposer(null);
  }, [requestFocus, setChatContext, setSelectedText]);

  return null;
}
