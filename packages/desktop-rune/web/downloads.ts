const DOWNLOAD_PREFIX = "/web-download/";

/** `dialog.saveFile` in a browser: a path whose write becomes a download of that name. */
export const downloadPath = (defaultPath?: string) => `${DOWNLOAD_PREFIX}${(defaultPath ?? "download").split(/[\\/]/).pop() || "download"}`;

export function writeDownload(path: string, data: BlobPart): boolean {
  if (!path.startsWith(DOWNLOAD_PREFIX)) return false;
  const url = URL.createObjectURL(new Blob([data]));
  const a = document.createElement("a");
  a.href = url;
  a.download = path.slice(DOWNLOAD_PREFIX.length);
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
  return true;
}
