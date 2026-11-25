import { Button, Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "../../kit/compat";
import { useAccountDialogs } from "../feedback/account-dialogs.styles";
import { usePill } from "../shared/pill.styles";
import { useCallback, useState } from "react";
import { useDesktopAuthSession } from "@/global/auth/services/auth-session";
import { useT } from "@/shared/i18n";
import { isSelfHostedServer } from "@/platform/backend/server-discovery";

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
  } catch {}
};

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
  const s = useAccountDialogs();
  const t = useT();
  return (
    <Dialog open={open} onOpenChange={(next) => {
        if (!next) onDismiss();
      }}>
      <DialogContent fit>
        <DialogHeader>
          <DialogTitle>{t(`${K}.claudeTitle`)}</DialogTitle>
        </DialogHeader>
        <DialogDescription>
          {t(isSelfHostedServer() ? `${K}.claudeSyncNoteSelfHosted` : `${K}.claudeSyncNote`)}
        </DialogDescription>
        <row {...s.sidebarConfirmActions}>
          <Button variant="primary" size="large" className="pill-btn pill-btn--primary pill-btn--lg" onClick={onDismiss} autoFocus>
            {t("common.gotIt")}
          </Button>
        </row>
      </DialogContent>
    </Dialog>
  );
}
