import { useEffect, useState, type ReactNode } from "react";
import { useT } from "@/shared/i18n";
import { useAppSourceState } from "@/features/app-source/app-source-store";
import { Icon, Icons, withStroke } from "../../kit";
import { derive, mixOklch, radius, useTokens } from "../../theme";

export type UpdateCardTone = "update" | "done" | "attention";

export type UpdateCardAction = { label: string; primary?: boolean; onClick: () => void };

const CHECK = { name: "app-update/check", view: 24, body: '<path d="M20 6 9 17l-5-5" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/>' };
const ring = (arc: number) => ({
  name: `app-update/ring-${arc}`,
  view: 20,
  body: `<circle cx="10" cy="10" r="7.5" fill="none" stroke="currentColor" stroke-opacity="0.2" stroke-width="2.2"/><circle cx="10" cy="10" r="7.5" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" pathLength="100" stroke-dasharray="${arc} 100" transform="rotate(-90 10 10)"/>`,
});
const RING_BUSY = ring(28);
const RING_FULL = ring(100);
const RING_FILL_MS = 210;
const SWAP_OUT_MS = 280;

type SwapVariant = "text" | "icon" | "label";

const SWAP_MOTION: Record<SwapVariant, { enter: object; exit: object }> = {
  text: { enter: { opacity: 0, y: 6, blur: 3, dur: 0.38, bounce: 0 }, exit: { opacity: 0, y: -6, blur: 3, dur: 0.2, bounce: 0 } },
  icon: { enter: { opacity: 0, scale: 0.5, blur: 3, dur: 0.42, bounce: 0.35 }, exit: { opacity: 0, scale: 0.5, blur: 3, dur: 0.16, bounce: 0 } },
  label: { enter: { opacity: 0, scale: 0.8, blur: 4, dur: 0.36, bounce: 0.25 }, exit: { opacity: 0, scale: 0.8, blur: 4, dur: 0.15, bounce: 0 } },
};

function Swap({ value, variant, appear = false, children }: { value: string; variant: SwapVariant; appear?: boolean; children: ReactNode }) {
  const [first] = useState(value);
  const entering = appear || value !== first;
  const motion = SWAP_MOTION[variant];
  return (
    <box key={value} minW={0} maxW="full" enter={entering ? motion.enter : undefined} exit={motion.exit}>
      {children}
    </box>
  );
}

function UpdateButton({ action, busy, disabled }: { action: UpdateCardAction; busy: boolean; disabled: boolean }) {
  const tokens = useTokens();
  const [ringShown, setRingShown] = useState(busy);
  const [filling, setFilling] = useState(false);
  const [afterRing, setAfterRing] = useState(false);
  useEffect(() => {
    if (busy) {
      setRingShown(true);
      setFilling(false);
      return;
    }
    if (!ringShown) return;
    setFilling(true);
    const timer = setTimeout(() => {
      setRingShown(false);
      setFilling(false);
      setAfterRing(true);
    }, RING_FILL_MS);
    return () => clearTimeout(timer);
  }, [busy, ringShown]);
  const look = derive(tokens, "app-update-card:button", (k) => ({ fill: mixOklch(k.c.foreground, 6, "transparent"), hover: mixOklch(k.c.foreground, 9, "transparent") }));
  const off = busy || disabled;
  return (
    <box
      role="button"
      focusable={!off}
      disabled={off}
      shrink={false}
      h={30}
      w={ringShown ? 30 : undefined}
      px={ringShown ? 0 : 14}
      center
      clip={radius.full}
      radius={radius.full}
      fill={look.fill}
      hoverFill={off ? undefined : look.hover}
      pressScale={off ? undefined : 0.94}
      opacity={disabled && !ringShown && !busy ? 0.5 : 1}
      layout={ringShown ? 0.38 : 0.42}
      cursor={off ? "default" : "pointer"}
      focusRing={{ color: tokens.c.ring, width: 2, offset: 0 }}
      onPress={off ? undefined : action.onClick}
    >
      {ringShown ? (
        <Icon icon={filling ? RING_FULL : RING_BUSY} size={18} color={tokens.c.primary} spin={filling ? undefined : 0.85} />
      ) : (
        <Swap value={action.label} variant="label" appear={afterRing}>
          <text size={13} weight={action.primary ? 700 : 600} color={action.primary ? tokens.c.primary : tokens.c.textStrong} nowrap>
            {action.label}
          </text>
        </Swap>
      )}
    </box>
  );
}

export const UpdateCard = ({
  tone,
  title,
  detail,
  action,
  busy = false,
  disabled = false,
  placement = "message",
}: {
  tone: UpdateCardTone;
  title: string;
  detail?: string;
  action: UpdateCardAction | null;
  busy?: boolean;
  disabled?: boolean;
  placement?: "message" | "composer";
}) => {
  const t = useT();
  const tokens = useTokens();
  const state = useAppSourceState();
  const shownDetail = !busy ? detail : state?.heldForRecording === true ? t("shell.appSource.afterRecording") : state?.heldForReply === true ? t("shell.appSource.afterReply") : detail;
  const look = derive(tokens, "app-update-card", (k) => ({
    update: { fill: mixOklch(k.c.primary, 13, "transparent"), color: k.c.primary },
    done: { fill: mixOklch(k.c.success, 15, "transparent"), color: k.c.success },
    attention: { fill: mixOklch(k.c.foreground, 6, "transparent"), color: k.c.textWeak },
  }));
  const icon = look[tone];
  const composer = placement === "composer";
  return (
    <row
      align="center"
      gap={12}
      w="full"
      maxW={composer ? 800 : 420}
      mt={composer ? 0 : 12}
      mb={composer ? 10 : 0}
      selfAlign={composer ? "center" : "start"}
      pt={11 + 1}
      pr={11 + 1}
      pb={11 + 1}
      pl={12 + 1}
      radius={radius["2xl"]}
      border={tokens.c.border}
      fill={composer ? tokens.c.surfaceInset : undefined}
      enter={composer ? undefined : { opacity: 0, y: 6, dur: 0.22, bounce: 0 }}
    >
      <box shrink={false} w={32} h={32} center radius={9} fill={icon.fill} motion={{ dur: 0.32, bounce: 0 }}>
        <Swap value={tone} variant="icon">
          <Icon icon={tone === "done" ? CHECK : withStroke(tone === "update" ? Icons.stella.RefreshCw : Icons.stella.AlertCircle, 2)} size={16} color={icon.color} />
        </Swap>
      </box>
      <col grow={1} minW={0}>
        <text size={14} weight={600} lineHeight={18.2} color={tokens.c.textStrong} title={title} nowrap truncate>
          {title}
        </text>
        {shownDetail === undefined ? null : (
          <box mt={1}>
            <Swap value={shownDetail} variant="text">
              <text size={12.5} lineHeight={16.875} color={tokens.c.textWeak}>
                {shownDetail}
              </text>
            </Swap>
          </box>
        )}
      </col>
      {action ? <UpdateButton action={action} busy={busy} disabled={disabled} /> : null}
    </row>
  );
};
