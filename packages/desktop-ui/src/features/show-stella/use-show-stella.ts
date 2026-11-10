import { useEffect, useState } from "react";
import type { ShowCaptureAttachment } from "@stella/contracts";
import type {
  ShowStellaStatus,
  ShowStellaTranscript,
} from "@stella/contracts/desktop/show-stella";
import type { ChatContext } from "@/shared/types/electron";
import { transcribeCapture } from "./capture-transcript";

const api = () => window.electronAPI?.showStella;

/**
 * In the main window: a recording that has stopped gets its words from the
 * user's dictation engine, then the builder makes the capture, which lands in
 * the composer.
 */
export function useShowStellaRecordings() {
  useEffect(() => {
    const showStella = api();
    if (!showStella) return;
    return showStella.onRecorded(({ captureId, hasAudio }) => {
      void (async () => {
        let transcript: ShowStellaTranscript;
        try {
          const wav = hasAudio ? await showStella.readAudio({ captureId }) : null;
          transcript = await transcribeCapture(wav);
        } catch (error) {
          console.warn("[show-stella] no transcript:", (error as Error)?.message);
          transcript = {
            source: "none",
            text: "",
            segments: [],
            words: [],
            missing: { reason: "The words couldn't be transcribed." },
          };
        }
        await showStella.build({ captureId, transcript }).catch((error: unknown) => {
          console.warn("[show-stella] build failed:", (error as Error)?.message);
        });
      })();
    });
  }, []);
}

/** Whether Show Stella can run here, and its shortcut. Hidden where it can't. */
export function useShowStellaStatus(): ShowStellaStatus | null {
  const [status, setStatus] = useState<ShowStellaStatus | null>(null);
  useEffect(() => {
    let cancelled = false;
    void api()
      ?.status()
      .then((next) => {
        if (!cancelled) setStatus(next);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);
  return status;
}

export const toggleShowStella = () => api()?.toggle();

/**
 * What a capture sends: its contact sheet as an image, its moments and words
 * as text the task reads, and the recording only when the user chose to keep
 * it in Drive.
 */
export const expandShowCaptures = (context: ChatContext | null | undefined): ChatContext | null => {
  if (!context) return null;
  const captures = context.showCaptures;
  if (!captures?.length) return context;
  const { showCaptures: _captures, ...rest } = context;
  const ready = captures.filter(
    (capture): capture is ShowCaptureAttachment & { contactSheet: NonNullable<ShowCaptureAttachment["contactSheet"]> } =>
      capture.status === "ready" && Boolean(capture.contactSheet),
  );
  if (ready.length === 0) return rest;
  return {
    ...rest,
    regionScreenshots: [
      ...(rest.regionScreenshots ?? []),
      ...ready.map((capture) => ({
        dataUrl: capture.contactSheet.previewUrl,
        previewUrl: capture.contactSheet.previewUrl,
        filePath: capture.contactSheet.path,
        width: capture.contactSheet.width,
        height: capture.contactSheet.height,
      })),
    ],
    pastedTexts: [
      ...(rest.pastedTexts ?? []),
      ...ready.map((capture) => capture.summary ?? "").filter(Boolean),
    ],
    files: [
      ...(rest.files ?? []),
      ...ready.flatMap((capture) =>
        capture.saveVideoToDrive && capture.video
          ? [
              {
                name: capture.video.name,
                size: capture.video.size,
                mimeType: capture.video.mimeType,
                dataUrl: "",
                path: capture.video.path,
              },
            ]
          : [],
      ),
    ],
  };
};

export const hasReadyShowCapture = (context: ChatContext | null | undefined) =>
  Boolean(context?.showCaptures?.some((capture) => capture.status === "ready"));
