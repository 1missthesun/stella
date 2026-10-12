/**
 * Media dimensions the app has already learned this session (a chat
 * thumbnail's load, a preview's metadata, the viewer's own measurement),
 * keyed by file path or URI without its query, so the file viewer can open at
 * its final size on the first frame.
 */

const MAX_ENTRIES = 400;
const aspects = new Map<string, number>();

const hintKey = (pathOrUri: string): string =>
  pathOrUri.trim().split(/[?#]/)[0] ?? pathOrUri;

export function rememberMediaSize(
  pathOrUri: string | null | undefined,
  width: number | undefined,
  height: number | undefined,
): void {
  if (!pathOrUri || !width || !height || width <= 0 || height <= 0) return;
  if (pathOrUri.startsWith("data:")) return;
  const key = hintKey(pathOrUri);
  aspects.delete(key);
  aspects.set(key, width / height);
  if (aspects.size > MAX_ENTRIES) {
    const oldest = aspects.keys().next().value;
    if (oldest !== undefined) aspects.delete(oldest);
  }
}

export function mediaAspect(
  ...pathsOrUris: readonly (string | null | undefined)[]
): number | null {
  for (const value of pathsOrUris) {
    if (!value || value.startsWith("data:")) continue;
    const aspect = aspects.get(hintKey(value));
    if (aspect) return aspect;
  }
  return null;
}

export function parseAspectRatio(value: string | undefined): number | null {
  const match = value
    ?.trim()
    .match(/^(\d+(?:\.\d+)?)\s*[:/x]\s*(\d+(?:\.\d+)?)$/);
  if (!match) return null;
  const width = Number(match[1]);
  const height = Number(match[2]);
  return width > 0 && height > 0 ? width / height : null;
}
