import { Linking } from "react-native";
import * as WebBrowser from "expo-web-browser";
import { canvasShareOpenUrl } from "./canvas-share-links";

export async function openWebLink(url: string): Promise<boolean> {
  if (!/^[a-z][a-z\d+.-]*:/i.test(url)) return false;
  try {
    if (/^https?:\/\//i.test(url)) {
      await WebBrowser.openBrowserAsync(await canvasShareOpenUrl(url));
    } else {
      await Linking.openURL(url);
    }
    return true;
  } catch (error) {
    console.warn("[link] open failed", url, error);
    return false;
  }
}
