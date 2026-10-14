import { useEffect } from "react";
import { AlertCircle, KeyRound, Lock, LogIn, X } from "@/ui/icons";
import { Button } from "@/ui/button";
import {
  dismissComposerNotice,
  registerComposerNoticeSurface,
  useComposerNotice,
  type ComposerNoticeAction,
  type ComposerNoticeKind,
} from "@/features/chat/composer-notice-store";
import { useT } from "@/shared/i18n";
import { ClaudeSignInNotice } from "@/features/claude/ClaudeSignInNotice";
import "./composer-notice.css";

const KIND_ICON: Record<ComposerNoticeKind, typeof LogIn> = {
  "sign-in": LogIn,
  upgrade: Lock,
  limit: AlertCircle,
  provider: KeyRound,
};

export const ComposerNotice = ({
  compact = false,
  conversationId,
}: {
  compact?: boolean;
  conversationId?: string | null;
}) => {
  const t = useT();
  const notice = useComposerNotice(conversationId);

  useEffect(() => registerComposerNoticeSurface(), []);

  if (!notice) return null;

  if (notice.claudeSignIn) {
    return (
      <ClaudeSignInNotice
        key={notice.id}
        notice={notice}
        compact={compact}
        onDismiss={() => dismissComposerNotice(notice.id)}
      />
    );
  }

  const Icon = KIND_ICON[notice.kind];
  const iconSize = compact ? 14 : 16;
  const run = (action: ComposerNoticeAction) => {
    dismissComposerNotice(notice.id);
    action.onClick();
  };

  return (
    <div
      className={`composer-notice composer-notice--${notice.kind}${compact ? " composer-notice--compact" : ""}`}
      role="status"
      data-testid="composer-notice"
    >
      <div className="composer-notice__icon" aria-hidden>
        <Icon size={iconSize} />
      </div>
      <div className="composer-notice__body">
        <p className="composer-notice__title">{notice.title}</p>
        {notice.description ? (
          <p className="composer-notice__sub">{notice.description}</p>
        ) : null}
      </div>
      {notice.action || notice.secondaryAction ? (
        <div className="composer-notice__actions">
          {notice.secondaryAction ? (
            <Button
              type="button"
              variant="ghost"
              className="pill-btn composer-notice__secondary"
              onClick={() => run(notice.secondaryAction!)}
            >
              {notice.secondaryAction.label}
            </Button>
          ) : null}
          {notice.action ? (
            <Button
              type="button"
              variant="primary"
              className="pill-btn pill-btn--primary composer-notice__primary"
              onClick={() => run(notice.action!)}
            >
              {notice.action.label}
            </Button>
          ) : null}
        </div>
      ) : null}
      <button
        type="button"
        className="composer-notice__dismiss"
        aria-label={t("common.close")}
        onClick={() => dismissComposerNotice(notice.id)}
      >
        <X size={14} />
      </button>
    </div>
  );
};
