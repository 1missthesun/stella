import { useCallback, useState } from "react";
import type {
  ChatGptSharedRegistration,
  EngineConnection,
  EngineSettings,
} from "@stella/contracts/backend/engines";
import type { ChatGptProfileSummary } from "@stella/contracts/chatgpt-siwc-types";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/ui/dropdown-menu";
import { Button } from "@/ui/button";
import { showToast } from "@/ui/toast";
import { useT } from "@/shared/i18n";
import { cloudEnginesApi } from "@/features/cloud/cloud-engines-api";
import { EngineConnectPrompt } from "@/features/cloud/EngineConnectPrompt";
import { useEngineConnect } from "@/features/cloud/use-engine-connect";
import { formatPlan } from "@/features/cloud/EngineAccountRow";
import {
  AiDetailsGroup,
  AiInUse,
  AiLink,
  AiNote,
  AiPrimaryAccount,
  AiProviderSection,
  AiRow,
  type AiMenuItem,
} from "@/features/cloud/AiProviderSection";
import {
  announceChatGptPlanUse,
  ContinueWithChatGptButton,
  openChatGptUsage,
} from "./ChatGptBrand";
import { useChatGptProfiles } from "./use-chatgpt-profiles";

const K = "settings.engineAccounts";

const sameEmail = (a: string | undefined, b: string | undefined) =>
  Boolean(a && b && a.trim().toLowerCase() === b.trim().toLowerCase());

type ChatGptAccount = {
  key: string;
  title: string;
  email?: string;
  plan?: string;
  clientId?: string;
  local?: ChatGptProfileSummary;
  cloud?: EngineConnection;
};

const matches = (
  account: { clientId?: string; email?: string },
  candidate: { clientId?: string; email?: string },
) =>
  Boolean(
    (account.clientId && account.clientId === candidate.clientId) ||
      sameEmail(account.email, candidate.email),
  );

function mergeAccounts(
  cloudConnections: readonly EngineConnection[],
  localProfiles: readonly ChatGptProfileSummary[],
  registrations: readonly ChatGptSharedRegistration[],
): ChatGptAccount[] {
  const accounts: ChatGptAccount[] = [];
  const add = (account: ChatGptAccount) => {
    accounts.push(account);
    return account;
  };

  for (const cloud of cloudConnections) {
    const local = localProfiles.find((profile) => matches(profile, cloud));
    add({
      key: `cloud:${cloud.accountId}`,
      title: cloud.email ?? cloud.name ?? cloud.label,
      ...(cloud.email ? { email: cloud.email } : {}),
      ...(cloud.plan ? { plan: cloud.plan } : {}),
      ...(cloud.clientId ? { clientId: cloud.clientId } : {}),
      ...(local ? { local } : {}),
      cloud,
    });
  }

  for (const local of localProfiles) {
    if (accounts.some((account) => account.local === local)) continue;
    add({
      key: `local:${local.id}`,
      title: local.email ?? local.name ?? local.label,
      ...(local.email ? { email: local.email } : {}),
      clientId: local.clientId,
      local,
    });
  }

  for (const registration of registrations) {
    if (!registration.email && !registration.name) continue;
    if (accounts.some((account) => matches(account, registration))) continue;
    add({
      key: `shared:${registration.clientId}`,
      title: registration.email ?? registration.name ?? registration.clientId,
      ...(registration.email ? { email: registration.email } : {}),
      clientId: registration.clientId,
    });
  }

  return accounts;
}

export function ChatGptAccountsSection({
  settings,
  refreshing,
  cloudAvailable,
  engineInUse = false,
  onUseEngine,
  useEngineDisabled = false,
}: {
  settings: EngineSettings | undefined;
  refreshing: boolean;
  cloudAvailable: boolean;
  engineInUse?: boolean;
  onUseEngine?: () => void;
  useEngineDisabled?: boolean;
}) {
  const t = useT();
  const useEngineButton = onUseEngine ? (
    <Button
      type="button"
      variant="ghost"
      className="pill-btn"
      disabled={useEngineDisabled}
      onClick={onUseEngine}
    >
      {t("settings.engineAccounts.use")}
    </Button>
  ) : null;
  const chatgpt = useChatGptProfiles();
  const connect = useEngineConnect();
  const [busy, setBusy] = useState(false);
  const { signIn } = chatgpt;
  const { start } = connect;

  const errorTitle = useCallback(
    (error: unknown) =>
      error instanceof Error && error.message ? error.message : t(`${K}.errorGeneric`),
    [t],
  );

  const run = useCallback(
    async (action: () => Promise<unknown>, done?: string) => {
      setBusy(true);
      try {
        await action();
        if (done) showToast({ title: done });
      } catch (error) {
        showToast({ title: errorTitle(error), variant: "error" });
      } finally {
        setBusy(false);
      }
    },
    [errorTitle],
  );

  const signInHere = useCallback(
    async (options?: {
      profileId?: string;
      sharedClientId?: string;
      enablePlanUsage?: boolean;
    }) => {
      try {
        const profile = await signIn(options);
        if (!profile) return;
        if (profile.planUsage) {
          showToast({ title: t(`${K}.chatgptComputerSignedIn`) });
          announceChatGptPlanUse();
        } else {
          showToast({
            title: t(`${K}.planUsageOffTitle`),
            description: t(`${K}.planUsageOffBody`),
          });
        }
      } catch (error) {
        showToast({ title: errorTitle(error), variant: "error" });
      }
    },
    [errorTitle, signIn, t],
  );

  const signInCloud = useCallback(
    async (options: { accountId?: string; clientId?: string; enablePlanUsage?: boolean } = {}) => {
      try {
        if (!(await start(options))) return;
        showToast({ title: t(`${K}.chatgptCloudSignedIn`) });
        announceChatGptPlanUse();
      } catch (error) {
        showToast({ title: errorTitle(error), variant: "error" });
      }
    },
    [errorTitle, start, t],
  );

  const revokeNote = (place: "cloud" | "computer", result: { revoked: boolean } | undefined | null) => {
    if (result && !result.revoked) {
      showToast({
        title: t(place === "cloud" ? `${K}.revokeTitleCloud` : `${K}.revokeTitleComputer`),
        description: t(`${K}.revokeUnconfirmed`),
      });
    }
  };

  if (!chatgpt.available && !cloudAvailable) return null;

  const cloudConnections = (settings?.connections ?? []).filter(
    (row) => row.provider === "chatgpt",
  );
  const accounts = mergeAccounts(
    cloudAvailable ? cloudConnections : [],
    chatgpt.available ? chatgpt.profiles : [],
    settings?.chatGptRegistrations ?? [],
  );
  const disabled = busy || refreshing || !chatgpt.loaded || connect.flow !== null;
  const adding = chatgpt.signingIn || connect.flow !== null;

  const statusOf = (account: ChatGptAccount): string | undefined => {
    const states = [account.local?.status, account.cloud?.status];
    if (states.includes("reauth_required")) return t(`${K}.statusReauth`);
    if (account.local?.planUsage === false || account.cloud?.planUsage === false) {
      return t(`${K}.statusPlanUsageOff`);
    }
    return undefined;
  };

  const addChatGpt = (label?: string) =>
    chatgpt.available ? (
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <ContinueWithChatGptButton label={label} disabled={disabled} loading={adding} />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" sideOffset={6} collisionPadding={12}>
          <DropdownMenuItem onSelect={() => void signInHere()}>
            {t(`${K}.addOnComputer`)}
          </DropdownMenuItem>
          <DropdownMenuItem disabled={!cloudAvailable} onSelect={() => void signInCloud()}>
            {t(`${K}.addInCloud`)}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    ) : (
      <ContinueWithChatGptButton
        label={label}
        onClick={() => void signInCloud()}
        disabled={disabled}
        loading={adding}
      />
    );

  const views = accounts.map((account) => {
    const { local, cloud } = account;
    const signedInHere = local?.status === "signed_in";
    const signedInCloud = Boolean(cloud && !cloud.status);

    const menu: AiMenuItem[] = [];
    if (chatgpt.available && !signedInHere) {
      menu.push({
        key: "in-here",
        label: t(`${K}.signInComputer`),
        onSelect: () =>
          void signInHere(
            local
              ? { profileId: local.id }
              : account.clientId
                ? { sharedClientId: account.clientId }
                : {},
          ),
      });
    }
    if (cloudAvailable && !signedInCloud) {
      menu.push({
        key: "in-cloud",
        label: t(`${K}.signInCloud`),
        onSelect: () =>
          void signInCloud(
            cloud
              ? { accountId: cloud.accountId }
              : account.clientId
                ? { clientId: account.clientId }
                : {},
          ),
      });
    }
    if (signedInHere && local?.planUsage === false) {
      menu.push({
        key: "plan-here",
        label: t(`${K}.enablePlanUsage`),
        onSelect: () => void signInHere({ profileId: local.id, enablePlanUsage: true }),
      });
    }
    if (signedInCloud && cloud?.planUsage === false) {
      menu.push({
        key: "plan-cloud",
        label: t(`${K}.enablePlanUsageCloud`),
        onSelect: () => void signInCloud({ accountId: cloud.accountId, enablePlanUsage: true }),
      });
    }
    if (local && local.status !== "signed_out") {
      menu.push({
        key: "out-here",
        label: t(`${K}.signOutComputer`),
        onSelect: () =>
          void run(
            async () => revokeNote("computer", await chatgpt.signOut(local.id)),
            t(`${K}.signedOut`),
          ),
      });
    }
    if (cloud && cloud.status !== "signed_out") {
      menu.push({
        key: "out-cloud",
        label: t(`${K}.signOutCloud`),
        onSelect: () =>
          void run(
            async () =>
              revokeNote("cloud", await cloudEnginesApi.disconnect("chatgpt", cloud.accountId)),
            t(`${K}.signedOut`),
          ),
      });
    }
    if (local || cloud) {
      menu.push({
        key: "remove",
        label: t(`${K}.remove`),
        onSelect: () =>
          void run(async () => {
            if (local) await chatgpt.remove(local.id);
            if (cloud) {
              await cloudEnginesApi.disconnect("chatgpt", cloud.accountId, { forget: true });
            }
          }, t(`${K}.removed`)),
      });
    }

    const usableHere = signedInHere && local?.planUsage !== false;
    const usableInCloud = signedInCloud && cloud?.planUsage !== false;
    const active =
      (!local || local.active) && (!cloud || cloud.active) && (usableHere || usableInCloud);
    const pick =
      !active && (usableHere || usableInCloud)
        ? () =>
            void run(async () => {
              if (cloud && usableInCloud && !cloud.active) {
                await cloudEnginesApi.setActiveAccount("chatgpt", cloud.accountId);
              }
              if (local && usableHere && !local.active) await chatgpt.setActive(local.id);
            })
        : undefined;
    const where =
      signedInHere && signedInCloud
        ? t(`${K}.whereBoth`)
        : signedInHere
          ? t(`${K}.whereComputer`)
          : signedInCloud
            ? t(`${K}.whereCloud`)
            : t(`${K}.whereNone`);
    return { account, menu, active, pick, where, status: statusOf(account) };
  });

  const primary = views.find((view) => view.active) ?? views.find((view) => view.pick) ?? views[0];
  const connected = Boolean(primary && (primary.account.local || primary.account.cloud));

  const details =
    views.length > 0 ? (
      <AiDetailsGroup label={t(`${K}.accountsLabel`)}>
        {views.map((view) => (
          <AiRow
            key={view.account.key}
            name={view.account.title}
            meta={[formatPlan(view.account.plan), view.where, view.status].filter(Boolean).join(" · ")}
            {...(view.active ? { inUseLabel: t(`${K}.inUse`) } : {})}
            {...(view.pick ? { onUse: view.pick, useLabel: t(`${K}.use`) } : {})}
            menuLabel={t(`${K}.moreLabel`, { name: view.account.title })}
            menu={view.menu}
            busy={disabled}
          />
        ))}
      </AiDetailsGroup>
    ) : undefined;

  return (
    <>
      <AiProviderSection
        id="chatgpt"
        titleKey={`${K}.chatgptTitle`}
        {...(connected ? { action: addChatGpt(t(`${K}.addAccount`)) } : {})}
        details={connected ? details : undefined}
        detailsLabel={t(`${K}.detailsLabelChatgpt`)}
        notes={
          <>
            {primary?.status ? <AiNote>{primary.status}</AiNote> : null}
            {chatgpt.signingIn ? (
              <AiNote
                action={
                  <button type="button" className="pill-btn" onClick={chatgpt.cancelSignIn}>
                    {t("common.cancel")}
                  </button>
                }
              >
                <span aria-live="polite">{t(`${K}.chatgptBrowserWaiting`)}</span>
              </AiNote>
            ) : null}
            {connect.flow ? <EngineConnectPrompt connect={connect} /> : null}
          </>
        }
      >
        {connected && primary ? (
          <AiPrimaryAccount
            name={primary.account.title}
            meta={
              <>
                {[formatPlan(primary.account.plan), primary.where].filter(Boolean).join(" · ")}
                <AiLink label={t(`${K}.manageUsage`)} onClick={openChatGptUsage} external />
              </>
            }
            {...(engineInUse && primary.active
              ? { status: <AiInUse label={t(`${K}.inUse`)} /> }
              : useEngineButton
                ? { status: useEngineButton }
                : {})}
          />
        ) : (
          <AiPrimaryAccount
            name={<span data-empty>{t(`${K}.notConnected`)}</span>}
            trailing={addChatGpt()}
          />
        )}
      </AiProviderSection>
    </>
  );
}
