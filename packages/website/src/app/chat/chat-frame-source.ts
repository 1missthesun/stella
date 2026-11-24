export const CHAT_FRAME_ID = "stella-chat-frame";
export const CHAT_APP_PATH = "/chat-app/index.html";

export function adoptChatFrameSource(frameId: string, appPath: string): void {
  const frame = document.getElementById(frameId);
  if (!frame || frame.getAttribute("src")) return;
  let source = appPath;
  try {
    const own = window.localStorage.getItem("stella:web-renderer");
    if (own && /^\/chat-app\/u\/u-[0-9a-f]{24}\/(?:[0-9a-f]{40}|[0-9a-f]{64})\/$/.test(own)) {
      source = `${own}index.html`;
    }
  } catch {
  }
  const rawFragment = window.location.hash.replace(/^#\??/, "");
  const containsHandoff =
    rawFragment.length > 0 && new URLSearchParams(rawFragment).has("ott");
  frame.setAttribute(
    "src",
    `${source}${containsHandoff ? window.location.hash : ""}`,
  );
  if (containsHandoff) {
    window.history.replaceState(
      window.history.state,
      "",
      `${window.location.pathname}${window.location.search}`,
    );
  }
}

export const CHAT_FRAME_BOOT_SCRIPT = `(${adoptChatFrameSource.toString()})(${JSON.stringify(CHAT_FRAME_ID)},${JSON.stringify(CHAT_APP_PATH)});`;
