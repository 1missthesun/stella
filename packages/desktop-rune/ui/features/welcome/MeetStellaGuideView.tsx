import { useMemo } from "react";
import { MEET_STELLA_GUIDE_HTML } from "@stella/contracts/meet-stella-guide";
import { MEET_STELLA_GUIDE_SLUG, MEET_STELLA_GUIDE_TITLE } from "@stella/contracts/welcome-message";
import { readCanvasActionManifest } from "@stella/contracts/canvas-actions";
import { useT } from "@/shared/i18n";
import { CanvasFrame, useHtmlCanvasSource } from "../../shell/display/canvas-tab/CanvasFrame";
import { useCanvasActions } from "../../shell/display/canvas-tab/use-canvas-frame-bridge";
import { PreviewProblem } from "../../shell/display/preview-states";

const IDENTITY = { canvas: MEET_STELLA_GUIDE_SLUG, title: MEET_STELLA_GUIDE_TITLE };

/** desktop-ui's `MeetStellaGuideView`: the guide in the same frame as any canvas, its buttons canvas actions that send the request to the chat. */
export default function MeetStellaGuideView() {
  const t = useT();
  const actions = useMemo(() => readCanvasActionManifest(MEET_STELLA_GUIDE_HTML), []);
  const { source, error } = useHtmlCanvasSource(MEET_STELLA_GUIDE_HTML);
  const { onFrameLoad } = useCanvasActions({ actions, identity: IDENTITY });
  if (error) {
    return (
      <col grow={1} center pad={24}>
        <PreviewProblem error={error || t("shell.display.canvas.loadFailed")} />
      </col>
    );
  }
  return (
    <col id="meet-stella-guide" grow={1} minH={0}>
      {source ? <CanvasFrame id="canvas-frame-meet-stella" title={MEET_STELLA_GUIDE_TITLE} source={source} onDocument={onFrameLoad} /> : null}
    </col>
  );
}
