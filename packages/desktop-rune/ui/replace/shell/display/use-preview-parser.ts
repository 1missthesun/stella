import { useEffect, useState } from "react";
import { parsePreview, type PreviewRequest, type PreviewResult } from "@/shell/display/preview-parser";

export const PREVIEW_UNAVAILABLE = "shell.display.preview.unavailable";
export const PREVIEW_WORKER_IDLE_MS = 30_000;

type PreviewResponse = { result?: PreviewResult; error?: string };

/** desktop-ui's preview parse, off the commit that asked for it (inputs are capped by the callers). */
export function usePreviewParser(request: PreviewRequest | null) {
  const [state, setState] = useState<{ request: PreviewRequest; response: PreviewResponse } | null>(null);
  useEffect(() => {
    if (!request) return;
    let live = true;
    const timer = setTimeout(() => {
      let response: PreviewResponse;
      try {
        response = { result: parsePreview(request) };
      } catch (error) {
        response = { error: error instanceof Error ? error.message : String(error) };
      }
      if (live) setState({ request, response });
    }, 0);
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [request]);
  return request && state?.request === request ? state.response : null;
}
