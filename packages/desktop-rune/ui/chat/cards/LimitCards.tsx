import { useEffect } from "react";
import { useT } from "@/shared/i18n";
import { dismissUsageLimitCard, registerUsageLimitCardSurface, useUsageLimitCard } from "@/features/chat/usage-limit-card";
import { useSafeguardCard } from "@/features/chat/safeguard-card";
import { Icons } from "../../kit";
import { useTokens } from "../../theme";
import { META_TEXT, ScheduleButton, ScheduleCard, ScheduleStatus } from "./ScheduleCard";

export function UsageLimitChatCard({ conversationId }: { conversationId: string | null | undefined }) {
  const t = useT();
  const tokens = useTokens();
  const card = useUsageLimitCard(conversationId);
  useEffect(() => registerUsageLimitCardSurface(), []);
  if (!card || !conversationId) return null;
  return (
    <ScheduleCard
      icon={Icons.stella.Pause}
      iconColor={tokens.colors.warning}
      headline={card.title}
      wrap
      label={card.title}
      dismiss={{ label: t("common.close"), onPress: () => dismissUsageLimitCard(conversationId) }}
      meta={
        card.description || card.resume ? (
          <>
            <ScheduleStatus wrap>{card.description ?? ""}</ScheduleStatus>
            {card.resume ? <ScheduleButton primary label="Resume" onPress={card.resume} /> : null}
          </>
        ) : undefined
      }
    />
  );
}

export function SafeguardChatCard({ conversationId, replying }: { conversationId: string | null | undefined; replying: boolean }) {
  const tokens = useTokens();
  const card = useSafeguardCard(conversationId);
  if (!card || !conversationId || replying) return null;
  const { notice, pending } = card;
  const working = pending !== undefined;
  return (
    <ScheduleCard icon={Icons.stella.AlertCircle} iconColor={tokens.colors.warning} headline={notice.title} wrap label={notice.title}>
      <text {...META_TEXT} color={tokens.c.textWeak}>
        {card.problem ?? notice.description}
      </text>
      <row wrap align="center" gap={12} rowGap={8} mt={8}>
        <ScheduleButton primary disabled={working} label={pending === "remove" ? "Removing…" : notice.remove.label} onPress={() => card.choose("remove")} />
        {notice.switchTo ? <ScheduleButton disabled={working} label={pending === "switch" ? "Switching…" : notice.switchTo.actionLabel} onPress={() => card.choose("switch")} /> : null}
        {notice.clear ? <ScheduleButton disabled={working} label={pending === "clear" ? "Starting fresh…" : notice.clear.label} onPress={() => card.choose("clear")} /> : null}
      </row>
    </ScheduleCard>
  );
}
