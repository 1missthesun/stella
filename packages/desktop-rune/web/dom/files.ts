/** Files from drops, pastes and pickers, under virtual paths the UI hands around as it does real paths on desktop. */
const files = new Map<string, File>();
let next = 1;

export const WEB_FILE_PREFIX = "/web-file/";

export function registerFile(file: File): string {
  const safe = (file.name || "file").replace(/[\\/]/g, "_");
  const path = `${WEB_FILE_PREFIX}${next++}/${safe}`;
  files.set(path, file);
  return path;
}

export const webFile = (path: string): File | undefined => files.get(path);

export function registerAll(list: FileList | File[] | null | undefined, exts?: string[]): string[] {
  if (!list) return [];
  const out: string[] = [];
  for (const f of Array.from(list)) {
    if (exts?.length) {
      const ext = f.name.split(".").pop()?.toLowerCase() ?? "";
      if (!exts.some((e) => e.replace(/^\./, "").toLowerCase() === ext)) continue;
    }
    out.push(registerFile(f));
  }
  return out;
}
