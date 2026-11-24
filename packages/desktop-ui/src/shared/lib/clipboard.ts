/**
 * Chromium refuses the page's `navigator.clipboard.writeText` (and
 * `execCommand("copy")`) unless the click that asked is under ~5 seconds
 * old, so on the web the write has to start inside the click: pending text
 * goes on as a ClipboardItem holding the promise, which browsers accept for
 * a write begun in the click.
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
  } catch {}
  return writeWithExecCommand(text);
};

const settled = async (source: ClipboardText): Promise<string | null> => {
  try {
    return (await source) || null;
  } catch {
    return null;
  }
};

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
      } catch {}
    }
    return await writeWithPage(text);
  })();
}
