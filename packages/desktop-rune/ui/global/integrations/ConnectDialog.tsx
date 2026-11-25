import { Button, Dialog, DialogBody, DialogCloseButton, DialogContent, DialogHeader, DialogTitle, T } from "../../kit/compat";
import { useConnectDialog } from "./ConnectDialog.styles";
import { useCallback } from "react";
import { useNavigate } from "@tanstack/react-router";
import { ExecutionDevicesCard } from "../../settings/ExecutionDevicesCard";
import { GetTheApp } from "./GetTheApp";
import { useAuthSessionState } from "@/global/auth/hooks/use-auth-session-state";
import { useT } from "@/shared/i18n";

interface ConnectDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export const ConnectDialog = ({ open, onOpenChange }: ConnectDialogProps) => {
  const s = useConnectDialog();
  const t = useT();
  const navigate = useNavigate();
  const { hasConnectedAccount } = useAuthSessionState();

  const handleSignIn = useCallback(() => {
    void navigate({
      to: ".",
      search: (prev: Record<string, unknown> | undefined) => ({
        ...(prev ?? {}),
        dialog: "auth" as const,
      }),
    });
  }, [navigate]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent fit frame={{ w: 440 }} maxH={720}>
        <DialogHeader>
          <DialogTitle>{t("global.integrations.connectStellaApp")}</DialogTitle>
          <DialogCloseButton />
        </DialogHeader>
        <DialogBody {...s.connectDialog_dialogBody}>
          <col {...s.connectSection}>
            <T role="heading" {...s.connectSectionTitle}>
              {t("global.integrations.getApp.title")}
            </T>
            <row {...s.connectPanel}>
              <GetTheApp />
            </row>
          </col>

          <col {...s.connectSection}>
            <T role="heading" {...s.connectSectionTitle}>
              {t("settings.executionDevices.title")}
            </T>
            {hasConnectedAccount ? (
              <ExecutionDevicesCard />
            ) : (
              <Button variant="secondary" onClick={handleSignIn}>
                {t("global.integrations.signInToConnect")}
              </Button>
            )}
          </col>
        </DialogBody>
      </DialogContent>
    </Dialog>
  );
};
