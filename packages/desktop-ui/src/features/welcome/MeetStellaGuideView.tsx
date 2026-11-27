import { useMemo, useRef } from "react";
import { MEET_STELLA_GUIDE_HTML } from "@stella/contracts/meet-stella-guide";
import { MEET_STELLA_GUIDE_SLUG, MEET_STELLA_GUIDE_TITLE } from "@stella/contracts/welcome-message";
import { readCanvasActionManifest } from "@stella/contracts/canvas-actions";
import { CanvasFrame, useHtmlCanvasSource } from "@/shell/display/canvas-tab/CanvasFrame";
import type { CanvasActionEvent } from "@stella/contracts/canvas-actions";
import { sendCanvasActionToChat, useCanvasActions } from "@/shell/display/canvas-tab/use-canvas-actions";
import { closeMeetStellaGuide } from "./open-meet-stella-guide";
import "@/shell/display/canvas-tab/canvas-tab.css";

const IDENTITY = { canvas: MEET_STELLA_GUIDE_SLUG, title: MEET_STELLA_GUIDE_TITLE };

// A "try this" button sends its request, then the guide steps aside so the
// chat behind it shows what came of it: the request and Stella's answer, or
// the notice that it waits for an AI to be chosen.
const sendAndClose = async (event: CanvasActionEvent) => {
  const sent = await sendCanvasActionToChat(event);
  closeMeetStellaGuide();
  return sent ? ("sent" as const) : ("failed" as const);
};

// The guide is drawn like any canvas Stella makes: the same frame, and its
// buttons are canvas actions that send Stella the request in the chat.
export default function MeetStellaGuideView() {
  const frameRef = useRef<HTMLIFrameElement | null>(null);
  const actions = useMemo(() => readCanvasActionManifest(MEET_STELLA_GUIDE_HTML), []);
  const { source } = useHtmlCanvasSource(MEET_STELLA_GUIDE_HTML);
  const { onFrameLoad } = useCanvasActions({ frame: () => frameRef.current, actions, identity: IDENTITY, onAction: sendAndClose });
  return (
    <div className="canvas-tab" data-testid="meet-stella-guide">
      <div className="canvas-tab__hero">
        <div className="canvas-tab__frame-wrap">
          {source ? (
            <CanvasFrame
              frameRef={frameRef}
              title={MEET_STELLA_GUIDE_TITLE}
              className="canvas-tab__iframe"
              source={source}
              onDocument={onFrameLoad}
            />
          ) : null}
        </div>
      </div>
    </div>
  );
}
