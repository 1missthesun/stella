import { MEET_STELLA_GUIDE_TITLE, WELCOME_TEXT } from "@stella/contracts/welcome-message";
import { openMeetStellaGuide } from "@/features/welcome/open-meet-stella-guide";
import { Markdown } from "../../chat/Markdown";
import { FilePillButton } from "../../chat/FilePills";

/** desktop-ui's `WelcomeMessage`: Stella's two-line first message, with the Meet Stella guide under it as a file pill. */
export function WelcomeMessage() {
  return (
    <col w="full" gap={0} id="welcome-message">
      <Markdown text={WELCOME_TEXT} cacheKey="welcome" hideHorizontalRules />
      <row wrap gap={6} minW={0} mt={10} mb={6}>
        <FilePillButton kind="canvas" name={MEET_STELLA_GUIDE_TITLE} title={MEET_STELLA_GUIDE_TITLE} onOpen={openMeetStellaGuide} />
      </row>
    </col>
  );
}
