/**
 * Copy text to the clipboard. Resolves to whether it was copied; it never
 * throws, and a `source` that rejects counts as not copied (the caller reads
 * that error from its own promise).
 *
 * The page's own `navigator.clipboard.writeText` is refused ("Write
 * permission denied") unless the click that asked for it is under ~5 seconds
 * old: after a link was fetched first, or from a native menu item, the page
 * has no click to show, Chromium asks for clipboard read access instead and
 * the app refuses that. `execCommand("copy")` fails the same way.
 *
 * - Desktop: the app writes the clipboard itself (main process), whenever
 *   the text is ready.
 * - Web: the write has to start inside the click. Text still on its way (a
 *   share link being made) goes on as a ClipboardItem holding the pending
 *   text, which browsers accept for a write begun in the click. So call this
 *   straight away in the click handler, with the promise, before awaiting
 *   anything.
 */
export type ClipboardText = string | Promise<string>;

const writeWithExecCommand = (text: string): boolean => {
  const textarea = document.createElement("textarea");
  textarea.value = text;
  textarea.setAttribute("readonly", "");
  textarea.style.position = "fixed";
  textarea.style.top = "0";
  textarea.style.left = "0";
  textarea.style.opacity = "0";
  textarea.style.pointerEvents = "none";
  const active = document.activeElement;
  const selection = document.getSelection();
  const previousRange =
    selection && selection.rangeCount > 0 ? selection.getRangeAt(0) : null;
  document.body.appendChild(textarea);
  try {
    textarea.focus();
    textarea.select();
    return document.execCommand("copy");
  } catch {
    return false;
  } finally {
    document.body.removeChild(textarea);
    if (previousRange && selection) {
      selection.removeAllRanges();
      selection.addRange(previousRange);
    }
    if (active instanceof HTMLElement) active.focus({ preventScroll: true });
  }
};

const writeWithPage = async (text: string): Promise<boolean> => {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // Refused: try the legacy path below.
  }
  return writeWithExecCommand(text);
};

const settled = async (source: ClipboardText): Promise<string | null> => {
  try {
    return (await source) || null;
  } catch {
    return null;
  }
};

/** Starts a web write inside the click, for text that isn't ready yet. */
const writePendingInBrowser = (
  pending: Promise<string>,
): Promise<boolean> | null => {
  const clipboard = navigator.clipboard;
  if (!clipboard?.write || typeof ClipboardItem === "undefined") return null;
  let started: Promise<void>;
  try {
    started = clipboard.write([
      new ClipboardItem({
        "text/plain": pending.then(
          (text) => new Blob([text], { type: "text/plain" }),
        ),
      }),
    ]);
  } catch {
    return null;
  }
  return started.then(
    () => true,
    async () => {
      const text = await settled(pending);
      return text ? await writeWithPage(text) : false;
    },
  );
};

export function copyTextToClipboard(source: ClipboardText): Promise<boolean> {
  const appWrite = window.electronAPI?.clipboard?.writeText;
  if (!appWrite && typeof source !== "string") {
    const started = writePendingInBrowser(source);
    if (started) return started;
  }
  return (async () => {
    const text = await settled(source);
    if (!text) return false;
    if (appWrite) {
      try {
        if ((await appWrite(text)).ok) return true;
      } catch {
        // An older app without the channel: the page's own paths below.
      }
    }
    return await writeWithPage(text);
  })();
}
