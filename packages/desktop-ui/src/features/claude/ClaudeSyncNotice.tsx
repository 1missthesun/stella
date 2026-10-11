import { useCallback, useState } from "react";
import { useDesktopAuthSession } from "@/global/auth/services/auth-session";
import { Button } from "@/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/ui/dialog";
import { useT } from "@/shared/i18n";

const K = "settings.engineAccounts";
const SEEN_KEY = "stella.claude-sync-notice-seen";

const seenKey = (userId: string) => `${SEEN_KEY}:${userId}`;

const readSeen = (userId: string): boolean => {
  try {
    return window.localStorage.getItem(seenKey(userId)) === "1";
  } catch {
    return false;
  }
};

const writeSeen = (userId: string) => {
  try {
    window.localStorage.setItem(seenKey(userId), "1");
  } catch {
    // Storage unavailable: it may show once more.
  }
};

/**
 * That a Claude account's full Claude Code sessions, tool outputs included,
 * sync to Stella's cloud: said once, after the first Claude account this user
 * adds on this computer, and never again once dismissed.
 */
export function useClaudeSyncNotice() {
  const session = useDesktopAuthSession();
  const userId =
    (session.data as { user?: { id?: string } } | null | undefined)?.user?.id ??
    null;
  const [open, setOpen] = useState(false);

  const announce = useCallback(() => {
    if (!userId || readSeen(userId)) return;
    setOpen(true);
  }, [userId]);

  const dismiss = useCallback(() => {
    if (userId) writeSeen(userId);
    setOpen(false);
  }, [userId]);

  return { open, announce, dismiss };
}

export function ClaudeSyncNoticeDialog({
  open,
  onDismiss,
}: {
  open: boolean;
  onDismiss: () => void;
}) {
  const t = useT();
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) onDismiss();
      }}
    >
      <DialogContent fit className="claude-sync-notice">
        <DialogHeader>
          <DialogTitle>{t(`${K}.claudeTitle`)}</DialogTitle>
        </DialogHeader>
        <DialogDescription>{t(`${K}.claudeSyncNote`)}</DialogDescription>
        <div className="sidebar-confirm-actions">
          <Button
            variant="primary"
            size="large"
            className="pill-btn pill-btn--primary pill-btn--lg"
            onClick={onDismiss}
            autoFocus
          >
            {t("common.gotIt")}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
