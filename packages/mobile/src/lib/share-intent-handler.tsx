import { useEffect } from "react";
import { useRouter } from "expo-router";
import { File } from "expo-file-system";
import { useShareIntentContext } from "expo-share-intent";
import { setPendingShare } from "./pending-share";
import {
  CHAT_ATTACHMENT_MAX_COUNT,
  driveFileNameFor,
  type PickedAttachment,
} from "./chat-attachments";

const asFileUri = (path: string) =>
  path.startsWith("file://") ? path : `file://${path}`;

export function ShareIntentHandler() {
  const router = useRouter();
  const { hasShareIntent, shareIntent, resetShareIntent } =
    useShareIntentContext();

  useEffect(() => {
    if (!hasShareIntent) return;

    let cancelled = false;
    void (async () => {
      const text = (shareIntent.webUrl ?? shareIntent.text ?? "").trim();
      const attachments: PickedAttachment[] = [];
      for (const file of shareIntent.files ?? []) {
        try {
          const uri = asFileUri(file.path);
          const mimeType = file.mimeType ?? "application/octet-stream";
          const kind = mimeType.startsWith("image/") ? "image" : "file";
          attachments.push({
            id: uri,
            uri,
            name: driveFileNameFor(file.fileName ?? file.path, kind),
            mimeType,
            sizeBytes: new File(uri).size ?? 0,
            kind,
          });
        } catch {
          // Skip unreadable files rather than dropping the whole share.
        }
        if (attachments.length >= CHAT_ATTACHMENT_MAX_COUNT) break;
      }
      if (cancelled) return;
      if (text || attachments.length > 0) {
        setPendingShare({
          ...(text ? { text } : {}),
          ...(attachments.length > 0 ? { attachments } : {}),
        });
        router.dismissTo("/chat");
      }
      resetShareIntent();
    })();

    return () => {
      cancelled = true;
    };
  }, [hasShareIntent, resetShareIntent, router, shareIntent]);

  return null;
}
