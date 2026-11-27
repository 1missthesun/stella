import { memo, useCallback, useMemo, useState } from "react";
import { cloudWorldDriveName, isCloudWorkspacePath } from "@stella/contracts/cloud-world-paths";
import { driveLinkPath } from "@stella/contracts/cloud-world-paths";
import { openCloudAppPanel } from "@/features/cloud/open-cloud-app-panel";
import { maybeHandleCanvasShareUrl } from "@/features/canvas-share/open-shared-canvas";
import { normalizedHttpUrl, openUrlInStellaBrowser } from "@/features/chat/lib/stella-web-links";
import { openLocalPath, showOpenPathError } from "@/features/chat/lib/open-local-path";
import { useOpenConversationFile } from "@/features/cloud/use-cloud-drive-open";
import { cloudDriveEntry } from "@/features/workspace-display/derive-conversation-files";
import { shouldUseBoundedMarkdownPlaintext } from "@/features/chat/streaming/markdown-chunks";
import { translateNow } from "@/shared/i18n";
import { derive, useTokens } from "../theme";
import { markdownStyle, useCodeActions, useTableActions, type ChatText } from "../kit";
import { fetchedImageSources, prepareChatMarkdown, stellaAppSlug, stellaFilePath } from "./markdown-source";
import { BUBBLE_FEATURES, CHAT_TABLE_HEADER_WEIGHT, useChatSurfaceLook } from "./chat-text";
import { rune } from "./engine";

interface MarkdownProps {
  text: string;
  cacheKey?: string;
  hideHorizontalRules?: boolean;
  hiddenFilePaths?: readonly string[];
  chat?: ChatText;
  onContextMenu?: (at: { x: number; y: number }) => void;
  /** Inside the timeline's selection group: a selection runs on across messages, as the page's does. */
  joinSelection?: boolean;
}

const openWeb = (url: string) => {
  if (maybeHandleCanvasShareUrl(url)) return;
  const api = window.electronAPI?.browserView;
  if (!api) {
    void window.electronAPI?.system?.openExternal(url);
    return;
  }
  void openUrlInStellaBrowser(url, api).catch(() => window.electronAPI?.system?.openExternal(url));
};

const openLocal = (filePath: string) => {
  if (isCloudWorkspacePath(filePath)) {
    showOpenPathError(translateNow("app.chat.fileLink.cloudWorkspaceOnly"));
    return;
  }
  void openLocalPath(filePath).then((error) => {
    if (error) showOpenPathError(error);
  });
};

/** desktop-ui's chat `Markdown` (Streamdown, static) on the engine's Markdown, with Stella's file and app links. */
export const Markdown = memo(function Markdown({ text, cacheKey, hideHorizontalRules = false, hiddenFilePaths, chat: chatOverride, onContextMenu, joinSelection = false }: MarkdownProps) {
  const t = useTokens();
  const surface = useChatSurfaceLook();
  const chat = chatOverride ?? surface.markdown;
  const [anonKey] = useState(() => `md-${Math.random().toString(36).slice(2)}`);
  const openFile = useOpenConversationFile();
  const tables = useTableActions(`md:${cacheKey ?? anonKey}`);
  const style = derive(t, `chat-markdown:${chat.size}:${chat.color ?? ""}`, (t) => ({
    ...markdownStyle(t, chat, false),
    body: { ...markdownStyle(t, chat, false).body, features: BUBBLE_FEATURES },
    codeMargin: [16, 16],
    tableMargin: [16, 16],
    tableHeaderWeight: CHAT_TABLE_HEADER_WEIGHT,
    tableFrame: { ...markdownStyle(t, chat, false).tableFrame, actionsFill: t.c.chatAssistantBubbleFillTop },
  }));
  const code = useCodeActions();
  const mdStyle = useMemo(() => {
    const framed = code.withCopied(tables.withFrame(style));
    return joinSelection ? { ...framed, joinSelection } : framed;
  }, [style, tables.withFrame, code.withCopied, joinSelection]);
  const linkStyles = derive(t, "chat-markdown-links", (t) => [{ prefix: "stella-file:", color: t.c.textInteractive, underline: t.c.textInteractive }]);
  const hiddenKey = hiddenFilePaths?.join("\0") ?? "";
  const source = useMemo(
    () => prepareChatMarkdown(text, { hideHorizontalRules, hiddenFilePaths: hiddenKey ? hiddenKey.split("\0") : [] }),
    [hiddenKey, hideHorizontalRules, text],
  );
  const images = useMemo(() => fetchedImageSources(source), [source]);
  const onLink = useCallback(
    (href: string) => {
      const slug = stellaAppSlug(href);
      if (slug) return openCloudAppPanel({ appId: slug });
      const filePath = stellaFilePath(href);
      if (filePath !== null) {
        const drivePath = driveLinkPath(filePath);
        if (drivePath) {
          void openFile(cloudDriveEntry({ path: drivePath, name: cloudWorldDriveName(drivePath), sizeBytes: 0, contentType: "application/octet-stream" }, Date.now()));
          return;
        }
        return openLocal(filePath);
      }
      const url = normalizedHttpUrl(href);
      if (url) return openWeb(url);
      void rune().shell.openExternal(href);
    },
    [openFile],
  );
  if (shouldUseBoundedMarkdownPlaintext(text.length)) {
    return (
      <text {...surface.text} color={t.c.chatAssistantBubbleText} features={BUBBLE_FEATURES} selectable onContextMenu={onContextMenu}>
        {text}
      </text>
    );
  }
  return (
    <>
      <markdown id={`md:${cacheKey ?? anonKey}`} src={source} selectable mdStyle={mdStyle} linkStyles={linkStyles} images={images} imageRadius={6} onLink={onLink} onCodeAction={code.onCodeAction} onTableAction={tables.onTableAction} onContextMenu={onContextMenu} w="fit" maxW="full" />
      {tables.overlay}
    </>
  );
});
