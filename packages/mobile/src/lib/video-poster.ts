import * as VideoThumbnails from "expo-video-thumbnails";

export const videoPosterUri = async (uri: string): Promise<string | null> => {
  try {
    const frame = await VideoThumbnails.getThumbnailAsync(uri, {
      time: 0,
      quality: 0.6,
    });
    return frame.uri;
  } catch {
    return null;
  }
};
