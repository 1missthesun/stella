const MEDIA_ORIGIN = "stella-media://local";

export const localMediaUrl = (filePath: string): string =>
  `${MEDIA_ORIGIN}/${encodeURIComponent(filePath)}`;
