import type { ReactNode } from "react";
import { Icon, Icons, type IconData } from "../../kit";
import { derive, fontSize, look, mix, mixOklch, radius, useTokens, type Tokens } from "../../theme";

export const scheduleCardLook = (t: Tokens) =>
  derive(t, "schedule-card", (k) => ({
    hover: mixOklch(k.c.chatAssistantBubbleFillTop, 92, k.c.foreground),
    tile: mixOklch(k.c.foreground, 7, "transparent"),
    dismissHover: mixOklch(k.c.foreground, 8, "transparent"),
    primaryHover: mix(k.c.foreground, 10, k.c.interactive),
    strike: mixOklch(k.c.textWeak, 60, "transparent"),
  }));

/** `.app` text: 15px, regular, 1.45, -0.01em. */
export const APP_TEXT = look(fontSize.lg, 400);
export const META_TEXT = { ...look(fontSize.base, 400), lineHeight: 18 };

/** `.schedule-card`: the assistant-bubble card with a 32pt clock tile, a headline and a meta line (reminders, schedules, limits). */
export function ScheduleCard({
  icon = Icons.stella.Clock,
  iconColor,
  headline,
  headlineStruck,
  wrap,
  meta,
  onPress,
  title,
  label,
  dismiss,
  children,
}: {
  icon?: IconData;
  iconColor?: string;
  headline: string;
  headlineStruck?: boolean;
  wrap?: boolean;
  meta?: ReactNode;
  onPress?: () => void;
  title?: string;
  label?: string;
  dismiss?: { label: string; onPress: () => void };
  children?: ReactNode;
}) {
  const t = useTokens();
  const l = scheduleCardLook(t);
  return (
    <row
      role={onPress ? "button" : undefined}
      focusable={Boolean(onPress)}
      label={label}
      title={title}
      cursor={onPress ? "pointer" : undefined}
      align="center"
      gap={10}
      w="fit"
      maxW="85%"
      minW={0}
      pt={8}
      pb={9}
      px={14}
      radius={radius["3xl"]}
      fill={t.c.chatAssistantBubbleFillTop}
      gradient={t.gradient.assistantBubble}
      hoverFill={onPress ? l.hover : undefined}
      motion={{ dur: 0.12, bounce: 0 }}
      onPress={onPress}
    >
      <box w={32} h={32} radius={9} fill={l.tile} center shrink={false}>
        <Icon icon={icon} size={16} strokeWidth={1.9} color={iconColor ?? t.c.textWeak} />
      </box>
      <col grow={1} shrink gap={1} minW={0}>
        <text {...APP_TEXT} weight={500} color={headlineStruck ? t.c.textWeak : t.c.chatAssistantBubbleText} strike={headlineStruck} nowrap={!wrap} truncate={!wrap} minW={0} pr={dismiss ? 24 : 0}>
          {headline}
        </text>
        {meta ? (
          <row align="center" justify="between" gap={12} minH={18} mt={dismiss ? 5 : 0}>
            {meta}
          </row>
        ) : null}
        {children}
      </col>
      {dismiss ? (
        <box absolute={{ top: 5, right: 9 }} w={24} h={24} center radius={radius.full} hoverFill={l.dismissHover} hoverGroup role="button" focusable cursor="pointer" label={dismiss.label} title={dismiss.label} onPress={dismiss.onPress}>
          <Icon icon={Icons.stella.X} size={14} color={t.c.textWeak} />
        </box>
      ) : null}
    </row>
  );
}

export function ScheduleStatus({ children, wrap }: { children: ReactNode; wrap?: boolean }) {
  const t = useTokens();
  return (
    <text {...META_TEXT} color={t.c.textWeak} features="'tnum' 1" nowrap={!wrap} truncate={!wrap} minW={0} shrink>
      {children}
    </text>
  );
}

/** `.schedule-card__button`: an underline-on-hover text action, or the filled primary pill. */
export function ScheduleButton({ label, primary, disabled, onPress, trailing }: { label: string; primary?: boolean; disabled?: boolean; onPress?: () => void; trailing?: ReactNode }) {
  const t = useTokens();
  const l = scheduleCardLook(t);
  if (primary) {
    return (
      <box role="button" focusable disabled={disabled} opacity={disabled ? 0.5 : 1} cursor="pointer" my={-2} py={4} px={10} radius={radius.full} fill={t.c.interactive} hoverFill={disabled ? undefined : l.primaryHover} onPress={disabled ? undefined : onPress}>
        <text {...META_TEXT} lineHeight={14} weight={500} color={t.c.interactiveForeground}>
          {label}
        </text>
      </box>
    );
  }
  return (
    <row role="button" focusable disabled={disabled} opacity={disabled ? 0.5 : 1} cursor="pointer" align="center" gap={3} hoverGroup onPress={disabled ? undefined : onPress}>
      <text {...META_TEXT} weight={500} color={t.c.textWeak} hoverColor={t.c.textWeak}>
        {label}
      </text>
      {trailing}
    </row>
  );
}
