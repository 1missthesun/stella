import { useEffect, useState, type ReactNode } from "react";
import { FOUND_VIA_ANSWERS, type FoundViaChoice } from "@stella/contracts/telemetry/anonymous-counts";
import { useT } from "@/shared/i18n";
import {
  dismissComposerNotice,
  registerComposerNoticeSurface,
  useComposerNotice,
  type ComposerNotice as ComposerNoticeRecord,
  type ComposerNoticeAction,
  type ComposerNoticeKind,
} from "@/features/chat/composer-notice-store";
import { ClaudeSignInNotice } from "@/features/claude/ClaudeSignInNotice";
import { useConnectPlanHeadsUp } from "@/features/chat/connect-plan/use-connect-plan-heads-up";
import { useConnectPlan } from "@/features/chat/connect-plan/use-connect-plan";
import { useClaudeLoginHeadsUp } from "@/features/claude/use-claude-login-heads-up";
import { AntigravitySignInPrompt } from "@/features/antigravity/AntigravitySignInPrompt";
import { ClaudeLoginPrompt } from "@/features/claude/ClaudeLoginPrompt";
import { ClaudeCliInstallStatus } from "@/features/claude/ClaudeCliInstallStatus";
import { EngineConnectPrompt } from "@/features/cloud/EngineConnectPrompt";
import { uiState } from "@/platform/ui-state";
import { recordAnonymousCount } from "@/features/anonymous-counts/record-anonymous-count";
import { FOUND_VIA_CHOICE_KEY, finishNudge } from "@/features/nudges/usage-nudges-store";
import { APP_TRACKING, BrandIcon, Button } from "../kit/compat";
import { Icon, Icons, type IconData } from "../kit";
import { derive, mixOklch, radius, useTokens } from "../theme";

const KIND_ICON: Record<ComposerNoticeKind, IconData> = {
  "sign-in": Icons.stella.LogIn,
  upgrade: Icons.stella.Lock,
  limit: Icons.stella.AlertCircle,
  provider: Icons.stella.KeyRound,
};

const NARROW_W = 600;

function useNoticeLook() {
  const t = useTokens();
  return derive(t, "composer-notice", (k) => ({
    tile: mixOklch(k.c.foreground, 5, "transparent"),
    dismissHover: mixOklch(k.c.foreground, 8, "transparent"),
    planFill: mixOklch(k.c.foreground, 3, "transparent"),
    planHover: mixOklch(k.c.foreground, 8, "transparent"),
    pill: mixOklch(k.c.foreground, 12, "transparent"),
    pillHover: mixOklch(k.c.foreground, 24, "transparent"),
    pillHoverFill: mixOklch(k.c.foreground, 4, "transparent"),
  }));
}

/** `.composer-notice`: centred over the composer at min(50rem, 100% − 96px), or the full width when compact. */
function NoticeFrame({
  compact,
  column,
  alignStart,
  pad,
  dismiss,
  label,
  role = "status",
  children,
}: {
  compact: boolean;
  column?: boolean;
  alignStart?: boolean;
  pad?: { y: number; compactY: number };
  dismiss: { label: string; onPress: () => void; inset: number };
  label?: string;
  role?: "status" | "group";
  children: ReactNode;
}) {
  const t = useTokens();
  const l = useNoticeLook();
  const [narrow, setNarrow] = useState(false);
  const py = compact ? (pad?.compactY ?? 9) : (pad?.y ?? 12);
  const frame = (
    <box
      role={role}
      label={label}
      w="full"
      maxW={compact ? undefined : 800}
      pt={py + 1}
      pb={py + 1}
      pl={(compact ? 10 : 14) + 1}
      pr={(compact ? 32 : 40) + 1}
      border={t.c.border}
      radius={compact ? radius.xl : radius["2xl"]}
      fill={t.c.surfaceInset}
      enter={{ opacity: 0, y: 6, dur: 0.2, bounce: 0 }}
    >
      {column ? (
        <col w="full" gap={10} align="stretch">
          {children}
        </col>
      ) : (
        <row w="full" align={alignStart ? "start" : "center"} gap={compact ? 9 : 12} wrap={compact && !alignStart}>
          {children}
        </row>
      )}
      <box absolute={{ top: dismiss.inset + 1, right: dismiss.inset + 1 }} w={24} h={24} center radius={radius.full} hoverFill={l.dismissHover} hoverGroup role="button" focusable cursor="pointer" label={dismiss.label} onPress={dismiss.onPress}>
        <icon svg={Icons.stella.X.body} name={Icons.stella.X.name} view={Icons.stella.X.view} size={14} color={t.c.textWeak} hoverColor={t.c.textStrong} />
      </box>
    </box>
  );
  if (compact) return <col w="full" mb={8}>{frame}</col>;
  return (
    <row w="full" justify="center" px={narrow ? 8 : 48} mb={10} onSize={(r) => setNarrow(r.w < NARROW_W)}>
      {frame}
    </row>
  );
}

function NoticeTile({ icon, compact, color, plain }: { icon: IconData; compact: boolean; color?: string; plain?: boolean }) {
  const t = useTokens();
  const l = useNoticeLook();
  const size = compact ? 28 : 34;
  return (
    <box w={size} h={size} radius={compact ? 8 : 10} border={t.c.border} fill={plain ? undefined : l.tile} center shrink={false}>
      <Icon icon={icon} size={compact ? 14 : 16} color={color ?? t.c.textWeak} />
    </box>
  );
}

function NoticeTitle({ children, compact, lineHeight }: { children: ReactNode; compact: boolean; lineHeight?: number }) {
  const t = useTokens();
  const size = compact ? 12.5 : 13;
  return (
    <text size={size} weight={600} lineHeight={lineHeight ?? Math.round(size * 1.45)} tracking={APP_TRACKING} color={t.c.textStrong}>
      {children}
    </text>
  );
}

function NoticeSub({ children, compact, mt = 2, grow }: { children: ReactNode; compact: boolean; mt?: number; grow?: boolean }) {
  const t = useTokens();
  const size = compact ? 11.5 : 12.5;
  return (
    <text size={size} lineHeight={Math.round(size * 1.35 * 100) / 100} tracking={APP_TRACKING} color={t.c.textWeak} maxLines={3} truncate mt={mt} grow={grow ? 1 : undefined} minW={0}>
      {children}
    </text>
  );
}

function NoticeActions({ compact, children, wide }: { compact: boolean; children: ReactNode; wide?: boolean }) {
  return (
    <row align="center" gap={8} shrink={false} w={compact && wide ? "full" : undefined} justify={compact && wide ? "end" : undefined}>
      {children}
    </row>
  );
}

const PILL_STYLE = { h: 28 } as const;

export const ComposerNotice = ({ compact = false, conversationId }: { compact?: boolean; conversationId?: string | null }) => {
  const t = useT();
  const tokens = useTokens();
  const notice = useComposerNotice(conversationId);

  useEffect(() => registerComposerNoticeSurface(), []);
  useConnectPlanHeadsUp(conversationId ?? null);
  useClaudeLoginHeadsUp();

  if (!notice) return null;
  if (notice.connectPlan) return <ConnectPlanNotice key={notice.id} notice={notice} compact={compact} onDismiss={() => dismissComposerNotice(notice.id)} />;
  if (notice.foundVia) return <FoundViaNotice key={notice.id} compact={compact} onClose={() => dismissComposerNotice(notice.id)} />;
  if (notice.claudeSignIn) return <ClaudeSignInNotice key={notice.id} notice={notice} compact={compact} onDismiss={() => dismissComposerNotice(notice.id)} />;

  const run = (action: ComposerNoticeAction) => {
    dismissComposerNotice(notice.id);
    action.onClick();
  };
  const inline = notice.kind === "limit";
  const actions =
    notice.action || notice.secondaryAction ? (
      <NoticeActions compact={compact} wide={!inline}>
        {notice.secondaryAction ? (
          <Button variant="ghost" className="pill-btn composer-notice__secondary" {...PILL_STYLE} onClick={() => run(notice.secondaryAction!)}>
            {notice.secondaryAction.label}
          </Button>
        ) : null}
        {notice.action ? (
          <Button variant="primary" className="pill-btn pill-btn--primary composer-notice__primary" {...PILL_STYLE} onClick={() => run(notice.action!)}>
            {notice.action.label}
          </Button>
        ) : null}
      </NoticeActions>
    ) : null;

  return (
    <NoticeFrame
      compact={compact}
      alignStart={inline}
      pad={inline ? { y: 9, compactY: 7 } : undefined}
      label={notice.title}
      dismiss={{ label: t("common.close"), onPress: () => dismissComposerNotice(notice.id), inset: inline ? (compact ? 4 : 6) : compact ? 6 : 8 }}
    >
      <NoticeTile icon={KIND_ICON[notice.kind]} compact={compact} color={inline ? tokens.colors.warning : undefined} />
      <col grow={1} minW={0}>
        <NoticeTitle compact={compact} lineHeight={inline ? (compact ? 17 : 18) : undefined}>
          {notice.title}
        </NoticeTitle>
        {inline ? (
          <row align="center" gap={10} mt={compact ? 6 : 8} mr={compact ? -23 : -29}>
            <NoticeSub compact={compact} mt={0} grow>
              {notice.description ?? ""}
            </NoticeSub>
            {actions}
          </row>
        ) : notice.description ? (
          <NoticeSub compact={compact}>{notice.description}</NoticeSub>
        ) : null}
      </col>
      {inline ? null : actions}
    </NoticeFrame>
  );
};

const answerFoundVia = (choice: FoundViaChoice, close: () => void) => {
  uiState.setItem(FOUND_VIA_CHOICE_KEY, choice);
  recordAnonymousCount({ type: "found_via", answer: choice });
  finishNudge("foundVia");
  close();
};

export function FoundViaNotice({ compact, onClose }: { compact: boolean; onClose: () => void }) {
  const t = useT();
  const tokens = useTokens();
  const l = useNoticeLook();
  return (
    <NoticeFrame compact={compact} alignStart role="group" label={t("nudges.foundVia.title")} dismiss={{ label: t("nudges.foundVia.skip"), onPress: () => answerFoundVia("skipped", onClose), inset: compact ? 6 : 8 }}>
      <NoticeTile icon={Icons.stella.Search} compact={compact} />
      <col grow={1} minW={0}>
        <NoticeTitle compact={compact}>{t("nudges.foundVia.title")}</NoticeTitle>
        <NoticeSub compact={compact}>{t("nudges.foundVia.body")}</NoticeSub>
        <row wrap gap={6} mt={10}>
          {FOUND_VIA_ANSWERS.map((choice) => (
            <box
              key={choice}
              role="button"
              focusable
              focusRing={{ width: 2, offset: 0, color: tokens.c.ring }}
              py={5 + 1}
              px={11 + 1}
              radius={radius.full}
              border={l.pill}
              hoverBorder={l.pillHover}
              hoverFill={l.pillHoverFill}
              pressScale={0.97}
              motion={{ dur: 0.16, bounce: 0 }}
              onPress={() => answerFoundVia(choice, onClose)}
            >
              <text size={12.5} lineHeight={15} tracking={APP_TRACKING} color={tokens.c.textBase}>
                {t(`nudges.foundVia.answers.${choice}`)}
              </text>
            </box>
          ))}
        </row>
      </col>
    </NoticeFrame>
  );
}

export function ConnectPlanNotice({ notice, compact, onDismiss }: { notice: ComposerNoticeRecord; compact: boolean; onDismiss: () => void }) {
  const tokens = useTokens();
  const l = useNoticeLook();
  const plan = useConnectPlan({ notice, onDismiss });
  const { t } = plan;
  const fine = { size: 12, lineHeight: 17, color: tokens.c.textWeak } as const;

  return (
    <NoticeFrame compact={compact} column label={plan.title} dismiss={{ label: t("common.close"), onPress: plan.close, inset: compact ? 6 : 8 }}>
      <row w="full" align="center" gap={compact ? 9 : 12} minW={0}>
        <NoticeTile icon={plan.reason === "no-engine" ? Icons.stella.Plug : Icons.stella.Lock} compact={compact} />
        <col grow={1} minW={0}>
          <NoticeTitle compact={compact}>{plan.title}</NoticeTitle>
          {plan.description ? <NoticeSub compact={compact}>{plan.description}</NoticeSub> : null}
        </col>
      </row>

      <row w="full" gap={8} mr={-28} role="group" label={t("chat.connectPlan.chooseTitle")}>
        {plan.options.map((option) => (
          <row
            key={option.id}
            role="button"
            focusable={!option.disabled}
            disabled={option.disabled}
            label={option.pending ? `${option.label}, ${t("common.loading")}` : option.label}
            grow={1}
            basis={0}
            minW={0}
            h={compact ? 36 : 40}
            px={12}
            align="center"
            justify="center"
            gap={8}
            radius={radius.lg}
            border={tokens.c.border}
            fill={l.planFill}
            hoverFill={option.disabled ? undefined : l.planHover}
            focusFill={l.planHover}
            opacity={option.disabled ? 0.55 : 1}
            cursor={option.disabled || option.pending ? undefined : "pointer"}
            onPress={option.disabled || option.pending ? undefined : () => plan.run(option.id)}
          >
            {option.pending ? (
              <Icon icon={Icons.stella.LoaderCircle} size={16} strokeWidth={2} color={tokens.c.primary} spin={0.8} />
            ) : (
              <BrandIcon brand={option.brand} size={18} />
            )}
            <text size={compact ? 12.5 : 13} weight={600} color={tokens.c.textStrong} maxLines={1} truncate>
              {option.label}
            </text>
          </row>
        ))}
      </row>

      {plan.flow === "claude-install" ? (
        <col w="full" mr={-28}>
          <ClaudeCliInstallStatus state={plan.claudeInstall.state} onRetry={plan.installClaude} />
        </col>
      ) : plan.flow === "claude-login" ? (
        <col w="full" mr={-28}>
          <ClaudeLoginPrompt login={plan.claudeLogin} />
        </col>
      ) : plan.flow === "chatgpt-connect" ? (
        <col w="full" mr={-28}>
          <EngineConnectPrompt connect={plan.connect} />
        </col>
      ) : plan.flow === "gemini" ? (
        <col w="full" mr={-28}>
          <AntigravitySignInPrompt antigravity={plan.antigravity} onStart={plan.retryGemini} />
        </col>
      ) : plan.flow === "waiting" ? (
        <row gap={4} align="center">
          <text {...fine}>{plan.waiting}</text>
          <box role="button" focusable cursor="pointer" onPress={plan.cancel}>
            <text {...fine} color={tokens.c.primary}>
              {t("common.cancel")}
            </text>
          </box>
        </row>
      ) : null}

      {plan.error ? (
        <text {...fine} role="alert" color={tokens.c.danger}>
          {plan.error}
        </text>
      ) : plan.fine ? (
        <text {...fine}>{plan.fine}</text>
      ) : null}

      {plan.plus || plan.other ? (
        <row w="full" mr={-28} align="center" justify="between" wrap gap={6} minW={0}>
          {plan.plus ? (
            <row align="center" gap={8} minW={0}>
              <text size={12.5} color={tokens.c.textWeak}>
                {plan.plus.lead}
              </text>
              <Button variant="ghost" className="pill-btn composer-notice__secondary" {...PILL_STYLE} disabled={plan.plus.busy} onClick={plan.plus.start}>
                {plan.plus.label}
              </Button>
            </row>
          ) : null}
          {plan.other ? (
            <box role="button" focusable cursor="pointer" onPress={plan.other.open}>
              <text size={12} color={tokens.c.textWeak} hoverColor={tokens.c.textStrong}>
                {plan.other.label}
              </text>
            </box>
          ) : null}
        </row>
      ) : null}
    </NoticeFrame>
  );
}
