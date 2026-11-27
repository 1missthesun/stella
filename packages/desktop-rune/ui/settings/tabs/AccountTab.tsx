import { SettingsCard, SettingsRow, SettingsTabContent, SettingsTabItem } from "../parts";
import { Button, Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, Press, T, showToast, tx } from "../../kit/compat";
import { useSettings } from "../settings.styles";
import { usePill } from "../../global/shared/pill.styles";
import { useAiAccounts } from "../../global/cloud/ai-accounts.styles";
import { SettingsTabHeader } from "../AiryControls";
import { useCallback, useState } from "react";
import { backendClient } from "@/platform/backend/backend-client";
import { useAuthSessionState } from "@/global/auth/hooks/use-auth-session-state";
import { deleteAuthUser } from "@/global/auth/services/auth-session";
import { clearCachedToken } from "@/global/auth/services/auth-token";
import { uiState } from "@/platform/ui-state";
import type { LegalDocument } from "@/global/legal/legal-text";
import { useT } from "@/shared/i18n";
import { getSettingsErrorMessage } from "@/global/settings/tabs/shared";
import { CloudBoundary } from "@/features/cloud/CloudBoundary";
import { SessionsCard } from "./SessionsCard";
import { PasskeysCard } from "./PasskeysCard";
import { ServerSettingsCard } from "../../global/self-host/ServerSettingsCard";
import { DevicesCard } from "../../global/devices/DevicesCard";
import { useSelfHostedServer } from "@/platform/backend/server-discovery";
import { useCurrentUser } from "@/global/auth/hooks/use-current-user";

type AccountDeleteAction = "data" | "account";

const deleteIndexedDatabase = (name: string) =>
  new Promise<void>((resolve) => {
    try {
      const request = indexedDB.deleteDatabase(name);
      request.onsuccess = () => resolve();
      request.onerror = () => resolve();
      request.onblocked = () => resolve();
    } catch {
      resolve();
    }
  });

async function clearLocalAccountState() {
  clearCachedToken();

  uiState.clear();

  try {
    localStorage.clear();
  } catch {}

  try {
    sessionStorage.clear();
  } catch {}

  if (
    typeof indexedDB !== "undefined" &&
    typeof indexedDB.databases === "function"
  ) {
    try {
      const databases = await indexedDB.databases();
      const names = databases
        .map((database) => database.name)
        .filter(
          (name): name is string => typeof name === "string" && name.length > 0,
        );
      await Promise.all(names.map(deleteIndexedDatabase));
    } catch {}
  }

  if (typeof caches !== "undefined") {
    try {
      const cacheNames = await caches.keys();
      await Promise.all(
        cacheNames.map((cacheName) => caches.delete(cacheName)),
      );
    } catch {}
  }

  await window.electronAPI?.ui.hardReset?.();
}

async function deleteCurrentBetterAuthUser() {
  return await deleteAuthUser();
}

interface AccountTabProps {
  onSignOut?: () => void;
  onOpenLegal?: (doc: LegalDocument) => void;
}

export function AccountTab({ onSignOut, onOpenLegal }: AccountTabProps) {
  const s = useSettings();
  const sAiAccounts = useAiAccounts();
  const t = useT();
  const selfHosted = useSelfHostedServer();
  const { hasConnectedAccount } = useAuthSessionState();
  const { user } = useCurrentUser();
  const email = user?.email?.trim();
  const [pendingDeleteAction, setPendingDeleteAction] =
    useState<AccountDeleteAction | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);
  const closeDeleteDialog = useCallback(
    (open: boolean) => {
      if (!open && !isDeleting) {
        setPendingDeleteAction(null);
      }
    },
    [isDeleting],
  );

  const handleConfirmDelete = useCallback(async () => {
    if (!pendingDeleteAction || isDeleting) return;
    const action = pendingDeleteAction;
    setIsDeleting(true);
    let scheduled = true;

    try {
      if (action === "data") {
        if (hasConnectedAccount) {
          await backendClient.call("account.reset", {});
        }
      } else {
        if (!hasConnectedAccount) {
          throw new Error(t("settings.account.toasts.signInBeforeDelete"));
        }
        scheduled = (await deleteCurrentBetterAuthUser()).scheduled;
      }

      await clearLocalAccountState();
      showToast(
        action === "data"
          ? t("settings.account.toasts.dataDeleted")
          : scheduled
            ? t("settings.account.toasts.deletionScheduled")
            : t("settings.account.toasts.accountDeleted"),
      );
      window.location.reload();
    } catch (error) {
      console.error(error);
      showToast(
        action === "account"
          ? t("settings.account.toasts.deleteAccountFailed")
          : getSettingsErrorMessage(
              error,
              t("settings.account.toasts.deleteDataFailed"),
            ),
      );
      setIsDeleting(false);
      setPendingDeleteAction(null);
    }
  }, [hasConnectedAccount, isDeleting, pendingDeleteAction, t]);

  const deleteDialogTitle =
    pendingDeleteAction === "account"
      ? t("settings.account.dialog.deleteAccountTitle")
      : t("settings.account.dialog.deleteDataTitle");
  const deleteDialogDescription =
    pendingDeleteAction === "account"
      ? t("settings.account.dialog.deleteAccountDescription")
      : t("settings.account.dialog.deleteDataDescription");
  const deleteDialogButton =
    pendingDeleteAction === "account"
      ? t("settings.account.dialog.deleteAccountButton")
      : t("settings.account.dialog.deleteDataButton");

  return (
    <SettingsTabContent account>
      <SettingsTabHeader titleKey="settings.account.title" cardKey="settings.account.title" />
      <SettingsCard>
        <SettingsRow>
          <col {...s.settingsRowInfo}>
            <T w="full" {...s.settingsRowLabel}>
              {email
                ? t("settings.account.signedInToStellaAs", { email })
                : t("settings.account.signOut.label")}
            </T>
          </col>
          <row {...s.settingsRowControl}>
            <Button variant="ghost" className="pill-btn" onClick={onSignOut}>
              {t("settings.account.signOut.thisComputer")}
            </Button>
          </row>
        </SettingsRow>
        <SettingsRow>
          <col {...s.settingsRowInfo}>
            <T w="full" {...s.settingsRowLabel}>
              {t("settings.account.deleteData.label")}
            </T>
          </col>
          <row {...s.settingsRowControl}>
            <Button variant="ghost" className="pill-btn pill-btn--danger" onClick={() => setPendingDeleteAction("data")} disabled={isDeleting}>
              {isDeleting && pendingDeleteAction === "data"
                ? t("settings.account.deleteData.working")
                : t("settings.account.deleteData.action")}
            </Button>
          </row>
        </SettingsRow>
        {/* The owner of a self-hosted server can't delete it from here. */}
        {selfHosted ? null : (
          <SettingsRow>
            <col {...s.settingsRowInfo}>
              <T w="full" {...s.settingsRowLabel}>
                {t("settings.account.deleteAccount.label")}
              </T>
            </col>
            <row {...s.settingsRowControl}>
              <Button variant="ghost" className="pill-btn pill-btn--danger" onClick={() => setPendingDeleteAction("account")} disabled={isDeleting || !hasConnectedAccount}>
                {isDeleting && pendingDeleteAction === "account"
                  ? t("settings.account.deleteAccount.working")
                  : t("settings.account.deleteAccount.action")}
              </Button>
            </row>
          </SettingsRow>
        )}
      </SettingsCard>
      <DevicesCard />
      {hasConnectedAccount ? (
        <CloudBoundary>
          <SessionsCard />
        </CloudBoundary>
      ) : null}
      {hasConnectedAccount ? <PasskeysCard /> : null}
      <ServerSettingsCard />
      <SettingsTabItem>
        <row {...sAiAccounts.aiLegal}>
          <Press text={tx(sAiAccounts.aiLegal)} {...sAiAccounts.aiLink} onPress={() => onOpenLegal?.("terms")}>
            {t("settings.account.legal.terms")}
          </Press>
          <Press text={tx(sAiAccounts.aiLegal)} {...sAiAccounts.aiLink} onPress={() => onOpenLegal?.("privacy")}>
            {t("settings.account.legal.privacy")}
          </Press>
        </row>
      </SettingsTabItem>
      <Dialog open={pendingDeleteAction !== null} onOpenChange={closeDeleteDialog}>
        <DialogContent fit {...s.settingsConfirmDialog}>
          <DialogHeader {...s.settingsConfirmDialog_dialogHeader}>
            <DialogTitle>{deleteDialogTitle}</DialogTitle>
          </DialogHeader>
          <DialogDescription>
            {deleteDialogDescription}
          </DialogDescription>
          <row {...s.settingsConfirmActions}>
            <Button variant="ghost" size="large" className="pill-btn pill-btn--lg" onClick={() => setPendingDeleteAction(null)} disabled={isDeleting}>
              {t("common.cancel")}
            </Button>
            <Button variant="primary" size="large" data-tone="destructive" className="pill-btn pill-btn--danger pill-btn--lg" onClick={() => void handleConfirmDelete()} disabled={isDeleting}>
              {isDeleting
                ? t("settings.account.dialog.working")
                : deleteDialogButton}
            </Button>
          </row>
        </DialogContent>
      </Dialog>
    </SettingsTabContent>
  );
}
