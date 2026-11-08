import { useEffect } from "react";
import { useT } from "@/shared/i18n";
import { showToast } from "@/ui/toast";
import { useCloudConversationSession } from "@/global/auth/hooks/use-cloud-conversation-session";
import { accountHintChanged } from "@/global/auth/hooks/use-account-hint";
import {
  isAccountScope,
  lastAccountScope,
  rememberAccountScope,
  wipeAccountsFromThisComputer,
} from "@/features/cloud/paused-account";

/**
 * When a different account signs in on this computer, the previous account's
 * chat copy and unsent messages are deleted before anything else uses them.
 */
export function AccountSwitchGuard() {
  const t = useT();
  const { accountScope, isCloudConversationReady } = useCloudConversationSession();
  useEffect(() => {
    if (!isCloudConversationReady || !isAccountScope(accountScope)) return;
    const previous = lastAccountScope();
    if (!previous || previous === accountScope) {
      rememberAccountScope(accountScope);
      return;
    }
    void wipeAccountsFromThisComputer(accountScope)
      .then(() => {
        accountHintChanged();
        showToast({ title: t("global.switchAccount.removed") });
      })
      .catch((error: unknown) =>
        console.warn("[auth] Couldn't remove the previous account's chat.", error),
      );
  }, [accountScope, isCloudConversationReady, t]);
  return null;
}
