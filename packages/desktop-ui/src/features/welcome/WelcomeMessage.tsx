import { MEET_STELLA_GUIDE_TITLE, WELCOME_TEXT } from "@stella/contracts/welcome-message";
import { Markdown } from "@/app/chat/Markdown";
import { FilePillButton } from "@/app/chat/FilePills";
import { openMeetStellaGuide } from "./open-meet-stella-guide";

// Stella's first message: two short lines from contracts (the same words every
// client shows and the model reads), with the Meet Stella guide under them
// the way a file Stella made sits under its message.
export function WelcomeMessage() {
  return (
    <div data-testid="welcome-message">
      <Markdown text={WELCOME_TEXT} cacheKey="welcome" hideHorizontalRules />
      <div className="agent-activity-files agent-activity-files--bubble">
        <div className="agent-activity-files__pills">
          <FilePillButton
            kind="canvas"
            name={MEET_STELLA_GUIDE_TITLE}
            title={MEET_STELLA_GUIDE_TITLE}
            onOpen={openMeetStellaGuide}
          />
        </div>
      </div>
    </div>
  );
}
