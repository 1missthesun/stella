import type { UserAskRecord } from "@stella/contracts/user-ask-deck";
import { useT } from "@/shared/i18n";
import { fontSize, radius, useTokens } from "../theme";

/** desktop-ui's `UserAskRecordCard`: each question Stella asked with the answer given, in an assistant bubble. */
export function UserAskRecordCard({ record }: { record: UserAskRecord }) {
  const t = useT();
  const tokens = useTokens();
  return (
    <col w="fit" maxW="85%" minW={0} py={4} px={16} radius={radius["3xl"]} fill={tokens.c.chatAssistantBubbleFillTop} gradient={tokens.gradient.assistantBubble}>
      {record.answers.map((answer, index) => {
        const skipped = answer.kind === "skipped";
        return (
          <col key={`${record.id}:${index}`} gap={2} minW={0} py={6}>
            <text size={fontSize.base} lineHeight={fontSize.base * 1.4} color={tokens.c.textWeak} selectable>
              {answer.question}
            </text>
            <row align="end" gap={8} wrap>
              <text size={fontSize.lg} weight={skipped ? 400 : 500} italic={skipped} lineHeight={fontSize.lg * 1.4} color={skipped ? tokens.c.textWeak : tokens.c.textStrong} selectable>
                {answer.kind === "provided" || answer.kind === "declined" ? t(`userAsk.secureInput.${answer.kind}`) : skipped ? t("userAsk.question.skipped") : answer.answer}
              </text>
              {record.defaulted ? (
                <text size={fontSize.sm} lineHeight={fontSize.sm * 1.4 + 2} color={tokens.c.textWeak}>
                  {t("userAsk.question.default")}
                </text>
              ) : null}
            </row>
            {(answer.kind === "provided" || answer.kind === "declined") && answer.answer ? (
              <text size={fontSize.lg} lineHeight={fontSize.lg * 1.45} color={tokens.c.chatAssistantBubbleText} selectable>
                {answer.answer}
              </text>
            ) : null}
          </col>
        );
      })}
    </col>
  );
}
