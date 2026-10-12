import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Image as NativeImage,
  Linking,
  ScrollView,
  Share,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
} from "react-native";
import * as Clipboard from "expo-clipboard";
import { AudioPlayerView } from "./AudioPlayerView";
import { PosterCover, VideoPlayerView } from "./VideoPlayerView";
import {
  cachedEvidenceSourceUri,
  requestEvidencePreview,
} from "../lib/chat-evidence-previews";
import * as Sharing from "expo-sharing";
import { Directory, File, Paths } from "expo-file-system";
import { WebView, type WebViewMessageEvent } from "react-native-webview";
import { getRandomBytes } from "expo-crypto";
import {
  DOCUMENT_SIZE_MESSAGE,
  canvasBridgeScript,
  documentSizeScript,
  withCanvasPolicy,
} from "../lib/canvas-policy";
import { AssistantMarkdown } from "./AssistantMarkdown";
import {
  FILE_VIEWER_MIN_HEIGHT,
  FileViewerFooter,
  FileViewerPanel,
  fileViewerContentWidth,
} from "./FileViewerPanel";
import {
  cachedViewerEntry,
  rememberViewerContentHeight,
  storeViewerEntry,
} from "../lib/artifact-viewer-cache";
import {
  mediaAspect,
  parseAspectRatio,
  rememberMediaSize,
} from "../lib/viewer-size-hints";
import type { PopoverAction } from "./FloatingPopoverParts";
import { canvasSlugFor, useCanvasShareToggle } from "../lib/use-canvas-share-toggle";
import type { ChatArtifact } from "../types";
import type { StoredPhoneAccess } from "../lib/phone-access";
import {
  artifactPrimaryFilePath,
  artifactFileName,
  viewedArtifact,
} from "../lib/mobile-artifacts";
import {
  assertReadableOnPairedComputer,
  bytesToDataUri,
  bytesToText,
  loadExistingOfficePreviewHtml,
  readLinkedArtifactFile,
} from "../lib/desktop-artifact-data";
import {
  downloadLinkedFile,
  isLinkedFileMissingError,
  linkedSourceDeviceId,
  linkedSourceIsFolder,
  listLinkedFolder,
  locateDeviceFile,
  renderLinkedOfficePreview,
  resolveLinkedFile,
  soleOnlineComputerAccess,
  subscribeLinkedFileProgress,
  type LinkedFileSource,
} from "../lib/linked-device-files";
import type {
  DeviceFolderEntry,
  DeviceFolderListing,
} from "@stella/contracts/device-file-reads";
import { DeviceFolderView, formatFileSize } from "./DeviceFolderView";
import { stellaFileChatArtifact } from "../lib/stella-file-links";
import { embedRelativeHtmlAssets } from "@stella/contracts/html-relative-assets";
import { sharePdf } from "../lib/chat-pdf";
import {
  createArtifactMediaFile,
  writeArtifactMediaFile,
  type ArtifactMediaFile,
} from "../lib/artifact-media-file";
import {
  DOCUMENT_PAGE_BACKGROUND,
  prepareDocumentHtml,
} from "../lib/html-document-preview";
import type { Colors } from "../theme/colors";
import { useColors } from "../theme/theme-context";
import { fonts } from "../theme/fonts";
import { classifyCanvasNavigation } from "../lib/canvas-navigation";
import {
  cloudDriveUrlExpiry,
  resolveCloudDriveFileUri,
} from "../lib/use-cloud-drive-file-uri";
import { notifyError, notifySuccess, tapLight } from "../lib/haptics";
import {
  SwipeArea,
  ZoomableImageView,
  type SwipeDirection,
} from "./ZoomableImageView";

type ArtifactViewerProps = {
  artifact: ChatArtifact | null;
  access: StoredPhoneAccess | null;
  visible: boolean;
  onClose: () => void;
  bottomReserve?: number;
} & ArtifactSwipeProps &
  ArtifactDeviceProps;

type ArtifactDeviceProps = {
  /** The computer an artifact's file is known to be on, when the opener knows. */
  deviceIdOf?: (artifact: ChatArtifact) => string | null;
};

type ArtifactSwipeProps = {
  /**
   * The list the artifact was opened from, in display order. An image can be
   * swiped to the images before and after it in this list.
   */
  siblings?: readonly ChatArtifact[];
  /** Show another artifact in place of the current one. */
  onNavigate?: (artifact: ChatArtifact) => void;
};

type ArtifactViewerContentProps = {
  artifact: ChatArtifact;
  access: StoredPhoneAccess | null;
  onClose: () => void;
  bottomReserve?: number;
} & ArtifactSwipeProps &
  ArtifactDeviceProps;

const isImageArtifact = (artifact: ChatArtifact): boolean =>
  artifact.payload.kind === "media" && artifact.payload.asset.kind === "image";

/** The images on either side of `artifact` in `siblings`. */
const imageNeighbours = (
  artifact: ChatArtifact | null,
  siblings: readonly ChatArtifact[] | undefined,
): { previous: ChatArtifact | null; next: ChatArtifact | null } => {
  if (!artifact || !siblings || !isImageArtifact(artifact)) {
    return { previous: null, next: null };
  }
  const images = siblings.filter(isImageArtifact);
  const index = images.findIndex((entry) => entry.id === artifact.id);
  if (index === -1) return { previous: null, next: null };
  return {
    previous: images[index - 1] ?? null,
    next: images[index + 1] ?? null,
  };
};

type LoadedArtifact =
  | { kind: "html"; html: string }
  | { kind: "canvas-html"; html: string }
  /**
   * A print-style HTML *document* (canvas HTML, office preview). Rendered on
   * a paper-white surface regardless of app theme; see html-document-preview.
   */
  | { kind: "html-document"; html: string }
  | { kind: "url"; uri: string }
  | { kind: "markdown"; text: string }
  | { kind: "text"; text: string }
  | { kind: "image"; uri: string }
  /** A `file://` PDF handed to the platform's own full-page PDF renderer. */
  | { kind: "pdf"; uri: string }
  /** A `file://` clip played by the native transport in `AudioPlayerView`. */
  | { kind: "audio"; uri: string }
  | { kind: "video"; uri: string; posterUri: string | null }
  | {
      kind: "folder";
      listing: DeviceFolderListing;
      deviceId: string | null;
      deviceName: string;
    };

const CANVAS_ASSET_MAX_BYTES = 16 * 1024 * 1024;
const VIEWER_MEDIA_MAX_BYTES = 2 * 1024 * 1024 * 1024;

type FolderTrailEntry = { artifact: ChatArtifact; preferDeviceId: string | null };

const isDevicePath = (filePath: string): boolean =>
  !/^(?:file|https?|data|content):/i.test(filePath.trim());

const folderName = (filePath: string): string =>
  filePath.replace(/[\\/]+$/, "").split(/[\\/]/).pop() || filePath;

const escapeHtml = (value: string): string =>
  value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

const newDocumentToken = (): string =>
  Array.from(getRandomBytes(24), (byte) => byte.toString(16).padStart(2, "0")).join("");

type DocumentMessage = {
  type?: unknown;
  token?: unknown;
  href?: unknown;
  height?: unknown;
  width?: unknown;
};

const parseDocumentMessage = (data: string): DocumentMessage | null => {
  try {
    const parsed: unknown = JSON.parse(data);
    return parsed && typeof parsed === "object" ? (parsed as DocumentMessage) : null;
  } catch {
    return null;
  }
};

const documentHeightInPoints = (
  message: DocumentMessage,
  token: string,
  viewWidth: number,
): number | null => {
  if (
    message.type !== DOCUMENT_SIZE_MESSAGE ||
    message.token !== token ||
    typeof message.height !== "number" ||
    typeof message.width !== "number" ||
    message.width <= 0 ||
    viewWidth <= 0
  ) {
    return null;
  }
  const points = message.height * (viewWidth / message.width);
  return Number.isFinite(points) && points > 0 ? Math.ceil(points) : null;
};

function DocumentWebView({
  html,
  style,
  onContentHeight,
}: {
  html: string;
  style: object;
  onContentHeight?: (height: number) => void;
}) {
  const { token, source } = useMemo(
    () => ({ token: newDocumentToken(), source: { html } }),
    [html],
  );
  const sizeScript = useMemo(() => documentSizeScript(token), [token]);
  const viewWidthRef = useRef(0);
  const handleMessage = useCallback(
    (event: WebViewMessageEvent) => {
      const message = parseDocumentMessage(event.nativeEvent.data);
      if (!message) return;
      const height = documentHeightInPoints(message, token, viewWidthRef.current);
      if (height !== null) onContentHeight?.(height);
    },
    [onContentHeight, token],
  );
  return (
    <WebView
      key={token}
      originWhitelist={["*"]}
      source={source}
      style={style}
      forceDarkOn={false}
      onLayout={(event) => {
        viewWidthRef.current = event.nativeEvent.layout.width;
      }}
      injectedJavaScriptBeforeContentLoaded={sizeScript}
      injectedJavaScript={sizeScript}
      onMessage={handleMessage}
    />
  );
}

function CanvasDocumentWebView({
  html,
  style,
  onContentHeight,
}: {
  html: string;
  style: object;
  onContentHeight?: (height: number) => void;
}) {
  const { token, source } = useMemo(
    () => ({
      token: newDocumentToken(),
      source: { html: withCanvasPolicy(html) },
    }),
    [html],
  );
  const bridgeScript = useMemo(() => canvasBridgeScript(token), [token]);
  const loadedTokenRef = useRef<string | null>(null);
  const viewWidthRef = useRef(0);

  const handleMessage = useCallback(
    (event: WebViewMessageEvent) => {
      const message = parseDocumentMessage(event.nativeEvent.data);
      if (!message) return;
      const height = documentHeightInPoints(message, token, viewWidthRef.current);
      if (height !== null) {
        onContentHeight?.(height);
        return;
      }
      if (
        message.type !== "stella:canvas-navigate" ||
        message.token !== token ||
        typeof message.href !== "string"
      ) {
        return;
      }
      const navigation = classifyCanvasNavigation(message.href);
      if (navigation.kind === "external") {
        void Linking.openURL(navigation.url).catch(() => undefined);
      }
    },
    [onContentHeight, token],
  );

  return (
    <WebView
      key={token}
      originWhitelist={["*"]}
      source={source}
      style={style}
      forceDarkOn={false}
      incognito
      cacheEnabled={false}
      allowFileAccess={false}
      allowFileAccessFromFileURLs={false}
      allowUniversalAccessFromFileURLs={false}
      allowsLinkPreview={false}
      javaScriptCanOpenWindowsAutomatically={false}
      setSupportMultipleWindows={false}
      sharedCookiesEnabled={false}
      thirdPartyCookiesEnabled={false}
      geolocationEnabled={false}
      mixedContentMode="never"
      dataDetectorTypes="none"
      onLayout={(event) => {
        viewWidthRef.current = event.nativeEvent.layout.width;
      }}
      injectedJavaScriptBeforeContentLoaded={bridgeScript}
      injectedJavaScript={bridgeScript}
      onMessage={handleMessage}
      onShouldStartLoadWithRequest={(request) => {
        const isCanvasDocument =
          request.url === "about:blank" ||
          request.url.startsWith("data:text/html");
        if (
          loadedTokenRef.current !== token &&
          isCanvasDocument &&
          request.isTopFrame !== false
        ) {
          loadedTokenRef.current = token;
          return true;
        }
        return false;
      }}
    />
  );
}

const delimitedToHtml = (
  colors: Colors,
  text: string,
  delimiter: "," | "\t",
) => {
  const rows = text
    .trim()
    .split(/\r?\n/)
    .slice(0, 200)
    .map((line) => line.split(delimiter).slice(0, 24));
  const table = rows
    .map(
      (row, rowIndex) =>
        `<tr>${row
          .map((cell) =>
            rowIndex === 0
              ? `<th>${escapeHtml(cell)}</th>`
              : `<td>${escapeHtml(cell)}</td>`,
          )
          .join("")}</tr>`,
    )
    .join("");
  return `<!doctype html>
<html>
<head>
<meta name="viewport" content="width=device-width, initial-scale=1" />
<meta name="color-scheme" content="light dark" />
<style>
html, body { margin: 0; background: ${colors.background}; color: ${colors.text}; font-family: -apple-system, BlinkMacSystemFont, sans-serif; }
body { padding: 16px; }
.wrap { overflow: auto; border: 1px solid ${colors.border}; border-radius: 12px; background: ${colors.surface}; }
table { border-collapse: collapse; min-width: 100%; font-size: 13px; }
th, td { border-bottom: 1px solid ${colors.border}; border-right: 1px solid ${colors.border}; padding: 8px 10px; text-align: left; vertical-align: top; }
th { position: sticky; top: 0; background: ${colors.muted}; font-weight: 600; }
</style>
</head>
<body><div class="wrap"><table>${table}</table></div></body>
</html>`;
};

const sharedImageFile = async (uri: string): Promise<string> => {
  if (uri.startsWith("file:")) return uri;
  const directory = new Directory(Paths.cache, "artifact-share");
  directory.create({ intermediates: true, idempotent: true });
  const name = decodeURIComponent(uri.split(/[?#]/)[0]?.split("/").pop() ?? "") || "image";
  const target = new File(directory, `${Date.now()}-${name.replace(/[^\w.\-]+/g, "_")}`);
  const downloaded = await File.downloadFileAsync(uri, target, { idempotent: true });
  return downloaded.uri;
};

const imageBase64 = async (uri: string): Promise<string> => {
  const inline = /^data:[^,]*;base64,(.*)$/s.exec(uri);
  if (inline?.[1]) return inline[1];
  return await new File(await sharedImageFile(uri)).base64();
};

const withoutQuery = (value: string): string => value.split(/[?#]/)[0] ?? value;

const viewerCacheKey = (
  artifact: ChatArtifact,
  preferDeviceId: string | null,
  theme: string,
): string | null => {
  const payload = artifact.payload;
  let target: string | null;
  if (payload.kind === "url") target = payload.url;
  else if (payload.kind === "office") target = `office:${payload.previewRef.sessionId}`;
  else if (payload.kind === "pdf" && payload.localUri) target = payload.localUri;
  else if (payload.kind === "media" && payload.asset.kind === "text") return null;
  else if (payload.kind === "source-diff") {
    target = `${payload.filePath}#${payload.patch?.length ?? 0}`;
  } else target = artifactPrimaryFilePath(payload);
  if (!target) return null;
  if (target.startsWith("data:")) target = `data:${artifact.id}:${target.length}`;
  const subKind = payload.kind === "media" ? payload.asset.kind : "";
  return [
    artifact.conversationId,
    payload.kind,
    subKind,
    withoutQuery(target),
    preferDeviceId ?? "",
    theme,
  ].join("|");
};

const loadedUri = (loaded: LoadedArtifact): string | null =>
  loaded.kind === "image" ||
  loaded.kind === "pdf" ||
  loaded.kind === "audio" ||
  loaded.kind === "video" ||
  loaded.kind === "url"
    ? loaded.uri
    : null;

const loadedStillThere = (loaded: LoadedArtifact): boolean => {
  const uri = loadedUri(loaded);
  if (!uri || !/^file:/i.test(uri)) return true;
  try {
    return new File(uri).exists;
  } catch {
    return false;
  }
};

const fileSize = (uri: string): number => {
  try {
    return new File(uri).size ?? 0;
  } catch {
    return 0;
  }
};

const loadedTextChars = (loaded: LoadedArtifact): number =>
  "html" in loaded ? loaded.html.length : "text" in loaded ? loaded.text.length : 0;

type ViewerShape = "fill" | "image" | "audio" | "content";

/** How the viewer sizes an artifact, known from its payload before it loads. */
const viewerShape = (artifact: ChatArtifact): ViewerShape => {
  const payload = artifact.payload;
  switch (payload.kind) {
    case "media":
      if (payload.asset.kind === "image") return "image";
      if (payload.asset.kind === "audio") return "audio";
      if (payload.asset.kind === "video") return "fill";
      return "content";
    case "markdown":
    case "source-diff":
    case "canvas-html":
      return "content";
    case "file-artifact":
      return payload.artifactKind === "delimited-table" ? "content" : "fill";
    default:
      return "fill";
  }
};

const payloadAspect = (artifact: ChatArtifact): number | null => {
  const payload = artifact.payload;
  if (payload.kind !== "media") return null;
  const paths = "filePaths" in payload.asset ? payload.asset.filePaths : [];
  return mediaAspect(...paths) ?? parseAspectRatio(payload.aspectRatio);
};

/**
 * The artifact display itself (body + footer) inside the file viewer panel.
 * The panel's size is worked out from what is already known (cached loads,
 * media dimensions seen in chat, the file type) so its first frame is its
 * final size; where that cannot be known it opens small and grows.
 */
export function ArtifactViewerContent({
  artifact: openedArtifact,
  access,
  onClose,
  bottomReserve,
  siblings: openedSiblings,
  onNavigate,
  deviceIdOf,
}: ArtifactViewerContentProps) {
  const [trailState, setTrailState] = useState<{
    root: ChatArtifact | null;
    entries: FolderTrailEntry[];
  }>({ root: null, entries: [] });
  const trail = useMemo(
    () => (trailState.root === openedArtifact ? trailState.entries : []),
    [openedArtifact, trailState],
  );
  const top = trail[trail.length - 1] ?? null;
  const preferDeviceId =
    top?.preferDeviceId ??
    (openedArtifact && deviceIdOf ? deviceIdOf(openedArtifact) : null);
  const shownArtifact = top?.artifact ?? openedArtifact;
  const artifact = useMemo(() => viewedArtifact(shownArtifact), [shownArtifact]);
  const siblings = useMemo(
    () => (trail.length > 0 ? undefined : openedSiblings?.map(viewedArtifact)),
    [openedSiblings, trail.length],
  );
  const popTrail = useCallback(() => {
    setTrailState((current) => ({
      root: openedArtifact,
      entries: (current.root === openedArtifact ? current.entries : []).slice(0, -1),
    }));
  }, [openedArtifact]);
  const onBack = trail.length > 0 ? popTrail : undefined;
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const { width: screenWidth } = useWindowDimensions();
  const cacheKey = useMemo(
    () => viewerCacheKey(artifact, preferDeviceId, colors.background),
    [artifact, colors.background, preferDeviceId],
  );
  const cachedEntry = useMemo(
    () => cachedViewerEntry<LoadedArtifact>(cacheKey, loadedStillThere),
    [cacheKey],
  );
  const [result, setResult] = useState<{
    artifact: ChatArtifact;
    key: string | null;
    loaded: LoadedArtifact | null;
    error: string | null;
  } | null>(null);
  const current =
    result &&
    (result.artifact === artifact || (cacheKey !== null && result.key === cacheKey))
      ? result
      : null;
  const loaded = current?.loaded ?? cachedEntry?.value ?? null;
  const error = current?.error ?? null;
  const loading = !loaded && !error;
  const resultRef = useRef(result);
  resultRef.current = result;

  const [progress, setProgress] = useState<{
    received: number;
    total: number;
  } | null>(null);
  useEffect(() => {
    setProgress(null);
    const filePath = artifactPrimaryFilePath(artifact.payload);
    if (!filePath) return;
    return subscribeLinkedFileProgress(filePath, (received, total) =>
      setProgress({ received, total }),
    );
  }, [artifact]);

  const openFolderEntry = useCallback(
    (entry: DeviceFolderEntry) => {
      if (loaded?.kind !== "folder") return;
      tapLight();
      const child = stellaFileChatArtifact(entry.path, artifact.conversationId);
      setTrailState((current) => ({
        root: openedArtifact,
        entries: [
          ...(current.root === openedArtifact ? current.entries : []),
          { artifact: child, preferDeviceId: loaded.deviceId },
        ],
      }));
    },
    [artifact, loaded, openedArtifact],
  );

  const shownFolder = loaded?.kind === "folder" ? loaded : null;
  const title = shownFolder
    ? folderName(shownFolder.listing.path)
    : artifactFileName(artifact.payload);

  const neighbours = useMemo(
    () => imageNeighbours(artifact, siblings),
    [artifact, siblings],
  );
  const onSwipe = useCallback(
    (direction: SwipeDirection) => {
      const target =
        direction === "next" ? neighbours.next : neighbours.previous;
      if (!target || !onNavigate) return;
      tapLight();
      onNavigate(target);
    },
    [neighbours, onNavigate],
  );
  const swipeable =
    Boolean(onNavigate) && Boolean(neighbours.previous || neighbours.next);

  // A paired-computer video shows its poster while it loads: the chat row
  // usually made one already, and the request for it is shared.
  const isVideo =
    artifact.payload.kind === "media" && artifact.payload.asset.kind === "video";
  const [pendingPoster, setPendingPoster] = useState<string | null>(null);
  useEffect(() => {
    setPendingPoster(null);
    if (artifact.payload.kind !== "media") return;
    if (artifact.payload.asset.kind !== "video") return;
    if ("driveBacked" in artifact.payload && artifact.payload.driveBacked === true) return;
    const filePath = artifactPrimaryFilePath(artifact.payload);
    if (!filePath) return;
    let alive = true;
    void requestEvidencePreview({
      filePath,
      kind: "video",
      conversationId: artifact.conversationId,
      access,
    })
      .then((preview) => {
        if (alive && preview.kind === "video") setPendingPoster(preview.posterUri);
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [artifact, access]);

  // On-device PDFs carry a local file URI we can hand straight to the OS share
  // sheet (save to Files / open in another app), without asking the computer.
  const localPdf =
    artifact.payload.kind === "pdf" &&
    artifact.payload.localUri
      ? artifact.payload
      : null;
  const [sharing, setSharing] = useState(false);
  const shareFile = useCallback(
    async (run: () => Promise<unknown>, failure: string) => {
      if (sharing) return;
      setSharing(true);
      try {
        await run();
      } catch {
        notifyError();
        Alert.alert(failure);
      } finally {
        setSharing(false);
      }
    },
    [sharing],
  );
  const copy = useCallback(
    async (run: () => Promise<unknown>, failure: string) => {
      try {
        await run();
        notifySuccess();
        return true;
      } catch {
        notifyError();
        Alert.alert(failure);
        return false;
      }
    },
    [],
  );
  const canvas =
    artifact.payload.kind === "canvas-html" ? artifact.payload : null;
  const canvasShare = useCanvasShareToggle(
    canvas ? canvasSlugFor(canvas.slug, canvas.filePath) : null,
    loaded?.kind === "canvas-html" ? loaded.html : null,
    canvas?.title,
  );
  const actions = useMemo<PopoverAction[]>(() => {
    if (!loaded) return [];
    if (canvas && canvasShare) {
      return [
        {
          key: "canvas-link",
          icon: "globe",
          accessibilityLabel: canvasShare.isPublic
            ? "Make canvas private"
            : "Make canvas public and copy its link",
          active: canvasShare.isPublic,
          loading: canvasShare.busy,
          confirm: true,
          onPress: async () => {
            try {
              const isPublic = await canvasShare.toggle();
              if (isPublic) notifySuccess();
              else tapLight();
              return isPublic;
            } catch {
              notifyError();
              Alert.alert("Couldn't change the canvas link");
              return false;
            }
          },
        },
      ];
    }
    switch (loaded.kind) {
      case "image": {
        const uri = loaded.uri;
        const shareable = /^(?:file|https?):/i.test(uri);
        return [
          {
            key: "copy",
            icon: "copy",
            accessibilityLabel: "Copy image",
            confirm: true,
            onPress: () =>
              copy(
                async () => Clipboard.setImageAsync(await imageBase64(uri)),
                "Couldn't copy the image",
              ),
          },
          ...(shareable
            ? [
                {
                  key: "share",
                  icon: "share" as const,
                  accessibilityLabel: "Share image",
                  loading: sharing,
                  onPress: () =>
                    shareFile(
                      async () =>
                        Sharing.shareAsync(await sharedImageFile(uri), {
                          mimeType: "image/*",
                          dialogTitle: "Share image",
                        }),
                      "Couldn't share the image",
                    ),
                },
              ]
            : []),
        ];
      }
      case "markdown":
      case "text": {
        const text = loaded.text;
        return [
          {
            key: "copy",
            icon: "copy",
            accessibilityLabel: "Copy text",
            confirm: true,
            onPress: () =>
              copy(() => Clipboard.setStringAsync(text), "Couldn't copy the text"),
          },
          {
            key: "share",
            icon: "share",
            accessibilityLabel: "Share text",
            onPress: () =>
              shareFile(
                () => Share.share({ message: text }),
                "Couldn't share the text",
              ),
          },
        ];
      }
      case "url": {
        const url = loaded.uri;
        return [
          {
            key: "copy",
            icon: "copy",
            accessibilityLabel: "Copy link",
            confirm: true,
            onPress: () =>
              copy(() => Clipboard.setStringAsync(url), "Couldn't copy the link"),
          },
          {
            key: "share",
            icon: "share",
            accessibilityLabel: "Share link",
            onPress: () =>
              shareFile(() => Share.share({ url }), "Couldn't share the link"),
          },
        ];
      }
      case "pdf": {
        const uri = loaded.uri;
        return [
          {
            key: "share",
            icon: "share",
            accessibilityLabel: "Save or share PDF",
            loading: sharing,
            onPress: () =>
              shareFile(async () => {
                if (localPdf) {
                  const result = await sharePdf(localPdf);
                  if (!result.ok) throw new Error(result.error);
                  return;
                }
                await Sharing.shareAsync(uri, {
                  mimeType: "application/pdf",
                  UTI: "com.adobe.pdf",
                  dialogTitle: "Share PDF",
                });
              }, "Couldn't share the PDF"),
          },
        ];
      }
      case "audio":
      case "video": {
        const uri = loaded.uri;
        const kind = loaded.kind;
        return /^file:/i.test(uri)
          ? [
              {
                key: "share",
                icon: "share",
                accessibilityLabel: kind === "video" ? "Share video" : "Share audio",
                loading: sharing,
                onPress: () =>
                  shareFile(
                    () => Sharing.shareAsync(uri, { dialogTitle: "Share" }),
                    kind === "video"
                      ? "Couldn't share the video"
                      : "Couldn't share the audio",
                  ),
              },
            ]
          : [];
      }
      default:
        return [];
    }
  }, [canvas, canvasShare, copy, loaded, localPdf, shareFile, sharing]);

  const [contentWidth, setContentWidth] = useState(() =>
    fileViewerContentWidth(screenWidth),
  );
  const [footerHeight, setFooterHeight] = useState(FOOTER_FALLBACK_HEIGHT);
  const [measured, setMeasured] = useState<{
    source: LoadedArtifact;
    height: number;
  } | null>(null);
  const [imageAspect, setImageAspect] = useState<{
    uri: string;
    aspect: number;
  } | null>(null);
  const measuredHeight =
    loaded && measured && measured.source === loaded
      ? measured.height
      : loaded && loaded === cachedEntry?.value
        ? cachedEntry.contentHeight
        : null;
  const reportScrollHeight = useCallback(
    (_width: number, height: number) => {
      if (!loaded || height <= 0) return;
      rememberViewerContentHeight(cacheKey, height);
      setMeasured((current) =>
        current?.source === loaded && Math.abs(current.height - height) < 1
          ? current
          : { source: loaded, height },
      );
    },
    [cacheKey, loaded],
  );
  const reportDocumentHeight = useCallback(
    (height: number) => {
      if (!loaded) return;
      setMeasured((current) => {
        if (current?.source === loaded && height <= current.height + 1) {
          return current;
        }
        rememberViewerContentHeight(cacheKey, height);
        return { source: loaded, height };
      });
    },
    [cacheKey, loaded],
  );
  const imageUri = loaded?.kind === "image" ? loaded.uri : null;
  useEffect(() => {
    if (!imageUri) return;
    let cancelled = false;
    NativeImage.getSize(
      imageUri,
      (width, height) => {
        if (!cancelled && width > 0 && height > 0) {
          rememberMediaSize(imageUri, width, height);
          rememberMediaSize(artifactPrimaryFilePath(artifact.payload), width, height);
          setImageAspect({ uri: imageUri, aspect: width / height });
        }
      },
      () => undefined,
    );
    return () => {
      cancelled = true;
    };
  }, [artifact, imageUri]);

  const shape = viewerShape(artifact);
  const knownAspect =
    (imageUri && imageAspect?.uri === imageUri ? imageAspect.aspect : null) ??
    mediaAspect(imageUri) ??
    payloadAspect(artifact);
  const placeholderBody = Math.max(0, FILE_VIEWER_MIN_HEIGHT - footerHeight);
  const bodyPreferredHeight: number | null = (() => {
    if (shape === "fill") return null;
    if (shape === "audio") return AUDIO_BODY_HEIGHT;
    if (shape === "image") {
      if (knownAspect && contentWidth > 0) return contentWidth / knownAspect;
      return error ? STATUS_BODY_HEIGHT : placeholderBody;
    }
    if (error) return STATUS_BODY_HEIGHT;
    return measuredHeight ?? placeholderBody;
  })();
  const preferredHeight =
    bodyPreferredHeight === null
      ? null
      : Math.ceil(bodyPreferredHeight + footerHeight);

  useEffect(() => {
    if (cachedEntry) return;
    const settled = resultRef.current;
    if (settled?.loaded && cacheKey !== null && settled.key === cacheKey) return;
    let cancelled = false;
    const controller = new AbortController();
    // PDFs and audio are handed to native renderers as real files. The viewer
    // cache takes them over when it keeps the load; otherwise they live only
    // as long as this artifact is on screen.
    let materialized: ArtifactMediaFile | null = null;

    const materialize = (
      bytes: Uint8Array,
      mimeType: string,
      sourcePath: string,
    ): string => {
      const file = writeArtifactMediaFile(bytes, mimeType, sourcePath);
      if (cancelled) file.remove();
      else materialized = file;
      return file.uri;
    };

    const load = async () => {
      const payload = artifact.payload;
      if (payload.kind === "url") {
        return { kind: "url" as const, uri: payload.url };
      }
      if (payload.kind === "media" && payload.asset.kind === "text") {
        return { kind: "text" as const, text: payload.asset.text };
      }
      // On-device PDF (cloud chat's `pdf` tool) — the file is already on disk,
      // so hand its URI straight to the viewer; the computer is not involved.
      if (payload.kind === "pdf" && payload.localUri) {
        return { kind: "pdf" as const, uri: payload.localUri };
      }
      if (payload.kind === "media" && payload.asset.kind === "image") {
        const filePath = payload.asset.filePaths[0];
        if (filePath && /^(?:file|https?|data):/i.test(filePath)) {
          return { kind: "image" as const, uri: filePath };
        }
      }
      // A cloud canvas (`html` in a cloud turn) lives in the owner's drive:
      // resolve its signed URL and render the document; no desktop needed.
      if (payload.kind === "canvas-html" && payload.driveBacked) {
        const uri = await resolveCloudDriveFileUri(payload.filePath);
        const response = await fetch(uri, { signal: controller.signal });
        if (!response.ok) throw new Error("This file is no longer available.");
        return {
          kind: "canvas-html" as const,
          html: prepareDocumentHtml(await response.text()),
        };
      }
      // Any other file the cloud journal reported lives in the owner's drive
      // too: resolve its signed URL and render it here, never over the
      // paired computer (desktop opens the same signed URL).
      if ("driveBacked" in payload && payload.driveBacked === true) {
        const drivePath = artifactPrimaryFilePath(payload);
        if (!drivePath) {
          throw new Error("This artifact does not have a mobile preview yet.");
        }
        const uri = await resolveCloudDriveFileUri(drivePath);
        const fetchText = async () => {
          const response = await fetch(uri, { signal: controller.signal });
          if (!response.ok) throw new Error("This file is no longer available.");
          return response.text();
        };
        if (payload.kind === "pdf") return { kind: "pdf" as const, uri };
        if (payload.kind === "markdown") {
          return { kind: "markdown" as const, text: await fetchText() };
        }
        if (payload.kind === "file-artifact") {
          if (payload.artifactKind === "delimited-table") {
            const delimiter = drivePath.toLowerCase().endsWith(".tsv") ? "\t" : ",";
            return {
              kind: "html" as const,
              html: delimitedToHtml(colors, await fetchText(), delimiter),
            };
          }
          // Office documents render in the platform web view from the URL.
          return { kind: "url" as const, uri };
        }
        if (payload.kind === "media") {
          if (payload.asset.kind === "image") return { kind: "image" as const, uri };
          if (payload.asset.kind === "audio") return { kind: "audio" as const, uri };
          if (payload.asset.kind === "video") {
            return { kind: "video" as const, uri, posterUri: null };
          }
          const response = await fetch(uri, { signal: controller.signal });
          if (!response.ok) throw new Error("This file is no longer available.");
          const contentType = response.headers.get("content-type") ?? "";
          if (/^(?:text\/|application\/(?:json|xml|javascript))/i.test(contentType)) {
            return { kind: "text" as const, text: await response.text() };
          }
          return { kind: "url" as const, uri };
        }
        return { kind: "url" as const, uri };
      }
      if (payload.kind === "office") {
        const officeAccess = access ?? (await soleOnlineComputerAccess());
        if (!officeAccess) {
          throw new Error(
            "The computer that made this document isn't online. Open Stella on it, then try again.",
          );
        }
        return {
          kind: "html-document" as const,
          html: prepareDocumentHtml(
            await loadExistingOfficePreviewHtml(
              officeAccess,
              artifact.conversationId,
              payload.previewRef.sessionId,
              controller.signal,
            ),
          ),
        };
      }
      const filePath = artifactPrimaryFilePath(payload);
      if (!filePath) {
        throw new Error("This artifact does not have a mobile preview yet.");
      }
      let source: LinkedFileSource | null = null;
      if (isDevicePath(filePath)) {
        assertReadableOnPairedComputer(filePath);
        source = await resolveLinkedFile(access, artifact.conversationId, filePath, {
          signal: controller.signal,
          preferDeviceId,
        }).catch((caught: unknown) => {
          throw isLinkedFileMissingError(caught)
            ? new Error("This file is no longer available.")
            : caught;
        });
        if (linkedSourceIsFolder(source)) {
          return {
            kind: "folder" as const,
            listing: await listLinkedFolder(
              source,
              artifact.conversationId,
              filePath,
              controller.signal,
            ),
            deviceId: linkedSourceDeviceId(source),
            deviceName:
              source.kind === "device"
                ? source.target.deviceName
                : source.deviceName,
          };
        }
      }
      if (
        payload.kind === "file-artifact" &&
        payload.artifactKind !== "delimited-table"
      ) {
        if (!source) {
          throw new Error("This artifact does not have a mobile preview yet.");
        }
        if (source.kind === "drive") {
          return {
            kind: "url" as const,
            uri: await resolveCloudDriveFileUri(source.drivePath),
          };
        }
        try {
          return {
            kind: "html-document" as const,
            html: prepareDocumentHtml(
              await renderLinkedOfficePreview(
                source,
                artifact.conversationId,
                filePath,
                controller.signal,
              ),
            ),
          };
        } catch (caught) {
          if (controller.signal.aborted) throw caught;
          const located = await locateDeviceFile(filePath);
          if (!located?.drivePath) throw caught;
          return {
            kind: "url" as const,
            uri: await resolveCloudDriveFileUri(located.drivePath),
          };
        }
      }

      if (payload.kind === "media" && payload.asset.kind === "video") {
        // The chat row's preview already pulled this clip onto the phone and
        // made its poster; play that copy rather than reading it again.
        const preview = await requestEvidencePreview({
          filePath,
          kind: "video",
          conversationId: artifact.conversationId,
          access,
        }).catch(() => null);
        const cached = cachedEvidenceSourceUri(filePath);
        if (cached) {
          return {
            kind: "video" as const,
            uri: cached,
            posterUri: preview?.kind === "video" ? preview.posterUri : null,
          };
        }
      }
      const playable =
        payload.kind === "pdf" ||
        (payload.kind === "media" &&
          (payload.asset.kind === "audio" ||
            payload.asset.kind === "image" ||
            payload.asset.kind === "video"));
      if (playable && source) {
        const media = createArtifactMediaFile(
          source.kind === "device"
            ? (source.stat?.mimeType ?? "application/octet-stream")
            : source.contentType,
          filePath,
        );
        if (cancelled) media.remove();
        else materialized = media;
        await downloadLinkedFile(
          source,
          artifact.conversationId,
          filePath,
          media.file,
          { signal: controller.signal, maxBytes: VIEWER_MEDIA_MAX_BYTES },
        );
        if (payload.kind === "pdf") return { kind: "pdf" as const, uri: media.uri };
        if (payload.kind === "media" && payload.asset.kind === "audio") {
          return { kind: "audio" as const, uri: media.uri };
        }
        if (payload.kind === "media" && payload.asset.kind === "image") {
          return { kind: "image" as const, uri: media.uri };
        }
        return { kind: "video" as const, uri: media.uri, posterUri: null };
      }
      const holderId = source ? linkedSourceDeviceId(source) : null;
      const result = await readLinkedArtifactFile(
        access,
        artifact.conversationId,
        filePath,
        controller.signal,
        { preferDeviceId },
      );
      if (result.missing) throw new Error("This file is no longer available.");

      if (payload.kind === "canvas-html") {
        const html = await embedRelativeHtmlAssets(
          bytesToText(result.bytes),
          filePath,
          async ({ path, kind }) => {
            const asset = await readLinkedArtifactFile(
              access,
              artifact.conversationId,
              path,
              controller.signal,
              { preferDeviceId: holderId, maxBytes: CANVAS_ASSET_MAX_BYTES },
            );
            if (asset.missing || asset.sizeBytes > CANVAS_ASSET_MAX_BYTES) {
              return null;
            }
            if (kind === "text") return bytesToText(asset.bytes);
            return asset.mimeType.startsWith("image/")
              ? bytesToDataUri(asset.bytes, asset.mimeType)
              : null;
          },
          controller.signal,
        );
        return {
          kind: "canvas-html" as const,
          html: prepareDocumentHtml(html),
        };
      }
      if (payload.kind === "markdown") {
        return { kind: "markdown" as const, text: bytesToText(result.bytes) };
      }
      if (payload.kind === "source-diff") {
        return {
          kind: "text" as const,
          text: payload.patch || bytesToText(result.bytes),
        };
      }
      if (
        payload.kind === "file-artifact" &&
        payload.artifactKind === "delimited-table"
      ) {
        const delimiter = filePath.toLowerCase().endsWith(".tsv") ? "\t" : ",";
        return {
          kind: "html" as const,
          html: delimitedToHtml(
            colors,
            bytesToText(result.bytes),
            delimiter,
          ),
        };
      }
      if (payload.kind === "pdf") {
        return {
          kind: "pdf" as const,
          uri: materialize(result.bytes, result.mimeType, filePath),
        };
      }
      if (payload.kind === "media") {
        if (payload.asset.kind === "audio") {
          return {
            kind: "audio" as const,
            uri: materialize(result.bytes, result.mimeType, filePath),
          };
        }
        if (payload.asset.kind === "image") {
          return {
            kind: "image" as const,
            uri: materialize(result.bytes, result.mimeType, filePath),
          };
        }
        if (payload.asset.kind === "video") {
          return {
            kind: "video" as const,
            uri: materialize(result.bytes, result.mimeType, filePath),
            posterUri: null,
          };
        }
      }
      return { kind: "text" as const, text: bytesToText(result.bytes) };
    };

    void load()
      .then((next: LoadedArtifact) => {
        if (cancelled) return;
        if (cacheKey !== null && next.kind !== "folder") {
          const uri = loadedUri(next);
          const owned = storeViewerEntry(cacheKey, next, {
            file: materialized,
            fileBytes: materialized ? fileSize(materialized.uri) : 0,
            textChars: loadedTextChars(next),
            expiresAt: uri && /^https?:/i.test(uri) ? cloudDriveUrlExpiry(uri) : null,
          });
          if (owned) materialized = null;
        }
        setResult({ artifact, key: cacheKey, loaded: next, error: null });
      })
      .catch((caught: unknown) => {
        if (cancelled) return;
        setResult({
          artifact,
          key: cacheKey,
          loaded: null,
          error: caught instanceof Error ? caught.message : String(caught),
        });
      });

    return () => {
      cancelled = true;
      controller.abort();
      materialized?.remove();
    };
  }, [access, artifact, cacheKey, cachedEntry, colors, preferDeviceId]);

  return (
    <FileViewerPanel
      onClose={onClose}
      closeLabel="Close"
      preferredHeight={preferredHeight}
      {...(bottomReserve !== undefined ? { bottomReserve } : {})}
    >
    <View
      style={styles.root}
      onLayout={(event) => {
        const next = event.nativeEvent.layout.width;
        if (next > 0) setContentWidth(next);
      }}
    >
        <View style={styles.body}>
          {(loading || error) && swipeable ? (
            <SwipeArea onSwipe={onSwipe}>
              <View style={styles.center}>
                {loading ? (
                  <ActivityIndicator color={colors.textMuted} />
                ) : (
                  <Text style={styles.error}>{error}</Text>
                )}
              </View>
            </SwipeArea>
          ) : loading && isVideo ? (
            <View style={styles.body}>
              <PosterCover posterUri={pendingPoster} colors={colors} />
              {progress ? (
                <View pointerEvents="none" style={styles.progressOverlay}>
                  <Text style={styles.progressPill}>
                    {`${formatFileSize(progress.received)} / ${formatFileSize(progress.total)}`}
                  </Text>
                </View>
              ) : null}
            </View>
          ) : loading ? (
            <View style={styles.center}>
              <ActivityIndicator color={colors.textMuted} />
              {progress ? (
                <Text style={styles.progress}>
                  {`${formatFileSize(progress.received)} / ${formatFileSize(progress.total)}`}
                </Text>
              ) : null}
            </View>
          ) : error ? (
            <View style={styles.center}>
              <Text style={styles.error}>{error}</Text>
            </View>
          ) : loaded?.kind === "url" ? (
            <WebView
              source={{ uri: loaded.uri }}
              style={styles.webview}
              startInLoadingState
              renderLoading={() => (
                <View style={styles.center}>
                  <ActivityIndicator color={colors.textMuted} />
                </View>
              )}
            />
          ) : loaded?.kind === "canvas-html" ? (
            <CanvasDocumentWebView
              html={loaded.html}
              style={styles.documentWebview}
              onContentHeight={reportDocumentHeight}
            />
          ) : loaded?.kind === "html-document" ? (
            <DocumentWebView
              html={loaded.html}
              style={styles.documentWebview}
              onContentHeight={reportDocumentHeight}
            />
          ) : loaded?.kind === "folder" ? (
            <DeviceFolderView
              listing={loaded.listing}
              colors={colors}
              onOpen={openFolderEntry}
            />
          ) : loaded?.kind === "pdf" ? (
            // Loading the file at the top level (rather than in an iframe)
            // hands it to the platform's own PDF renderer, which fits the page
            // to the width, scrolls through pages, and pinch-zooms — the same
            // full-bleed treatment HTML documents get.
            <WebView
              originWhitelist={["*"]}
              source={{ uri: loaded.uri }}
              style={styles.documentWebview}
              allowFileAccess
              forceDarkOn={false}
            />
          ) : loaded?.kind === "audio" ? (
            <AudioPlayerView uri={loaded.uri} />
          ) : loaded?.kind === "video" ? (
            <VideoPlayerView
              key={loaded.uri}
              uri={loaded.uri}
              posterUri={loaded.posterUri ?? pendingPoster}
              colors={colors}
            />
          ) : loaded?.kind === "html" ? (
            <DocumentWebView
              html={loaded.html}
              style={styles.webview}
              onContentHeight={reportDocumentHeight}
            />
          ) : loaded?.kind === "image" ? (
            <ZoomableImageView
              key={loaded.uri}
              uri={loaded.uri}
              accessibilityLabel={title}
              hasPrevious={Boolean(neighbours.previous)}
              hasNext={Boolean(neighbours.next)}
              {...(swipeable ? { onSwipe } : {})}
              {...(onClose ? { onDismiss: onClose } : {})}
            />
          ) : loaded?.kind === "markdown" ? (
            <ScrollView
              contentContainerStyle={styles.scrollContent}
              onContentSizeChange={reportScrollHeight}
            >
              <AssistantMarkdown text={loaded.text} colors={colors} />
            </ScrollView>
          ) : loaded?.kind === "text" ? (
            <ScrollView
              contentContainerStyle={styles.scrollContent}
              onContentSizeChange={reportScrollHeight}
            >
              <Text style={styles.monospace}>{loaded.text}</Text>
            </ScrollView>
          ) : null}
      </View>
      <View
        onLayout={(event) => {
          const next = Math.ceil(event.nativeEvent.layout.height);
          if (next > 0) setFooterHeight(next);
        }}
      >
        <FileViewerFooter
          name={title}
          actions={actions}
          onBack={onBack}
          onClose={onClose}
          closeLabel="Close"
        />
      </View>
    </View>
    </FileViewerPanel>
  );
}

/**
 * The artifact viewer opened from chat cards, links and Files: a centred
 * popover sized to its content, the file name and actions in its footer.
 */
export function ArtifactViewer({
  artifact,
  access,
  visible,
  onClose,
  siblings,
  onNavigate,
  deviceIdOf,
  bottomReserve,
}: ArtifactViewerProps) {
  if (!visible || !artifact) return null;
  return (
    <ArtifactViewerContent
      artifact={artifact}
      access={access}
      onClose={onClose}
      {...(bottomReserve !== undefined ? { bottomReserve } : {})}
      {...(siblings ? { siblings } : {})}
      {...(onNavigate ? { onNavigate } : {})}
      {...(deviceIdOf ? { deviceIdOf } : {})}
    />
  );
}

const FOOTER_FALLBACK_HEIGHT = 49;
const STATUS_BODY_HEIGHT = 200;
const AUDIO_BODY_HEIGHT = 260;

const makeStyles = (colors: ReturnType<typeof useColors>) =>
  StyleSheet.create({
    root: {
      flex: 1,
    },
    body: {
      flex: 1,
    },
    webview: {
      backgroundColor: "transparent",
      flex: 1,
    },
    documentWebview: {
      backgroundColor: DOCUMENT_PAGE_BACKGROUND,
      flex: 1,
    },
    center: {
      alignItems: "center",
      flex: 1,
      justifyContent: "center",
      padding: 24,
    },
    error: {
      color: colors.textMuted,
      fontFamily: fonts.sans.regular,
      fontSize: 14,
      lineHeight: 20,
      textAlign: "center",
    },
    scrollContent: {
      padding: 18,
    },
    progress: {
      color: colors.textMuted,
      fontFamily: fonts.sans.regular,
      fontSize: 12,
      marginTop: 10,
    },
    progressOverlay: {
      alignItems: "center",
      bottom: 24,
      left: 0,
      position: "absolute",
      right: 0,
    },
    progressPill: {
      backgroundColor: colors.overlay,
      borderRadius: 10,
      color: "#ffffff",
      fontFamily: fonts.sans.medium,
      fontSize: 12,
      overflow: "hidden",
      paddingHorizontal: 10,
      paddingVertical: 4,
    },
    monospace: {
      color: colors.text,
      fontFamily: fonts.mono.regular,
      fontSize: 12,
      lineHeight: 18,
    },
  });
