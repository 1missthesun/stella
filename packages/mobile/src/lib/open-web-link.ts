import { Linking } from "react-native";
import * as WebBrowser from "expo-web-browser";
import { canvasShareOpenUrl } from "./canvas-share-links";

/**
 * Opens a link the way a link in a chat message does: web pages in the
 * in-app browser (a shared canvas through its owner view), anything else
 * (mail, phone) with the system.
 */
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
