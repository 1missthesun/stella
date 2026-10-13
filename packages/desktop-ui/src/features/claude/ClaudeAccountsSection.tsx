import { useCallback, useEffect, useState } from "react";
import type {
  ClaudePlaceStatus,
  EngineConnection,
  EngineSettings,
} from "@stella/contracts/backend/engines";
import type { DeviceDestination } from "@stella/contracts/turn-plane/placement";
import type { ClaudeLocalConfig } from "@stella/contracts/claude-local-accounts";
import { Button } from "@/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/ui/dropdown-menu";
import { CloudIcon, Globe, Monitor } from "@/ui/icons";
import { showToast } from "@/ui/toast";
import { useT } from "@/shared/i18n";
import { getDeviceIdOrNull } from "@/platform/electron/device-id";
import { useBackendValue } from "@/platform/backend/use-backend-view";
import { cloudEnginesApi } from "@/features/cloud/cloud-engines-api";
import {
  accountInitials,
  EngineAccountHeader,
  EngineAccountRowView,
  formatPlan,
  type EngineAccountMenuItem,
} from "@/features/cloud/EngineAccountRow";
import { ClaudeLoginPrompt } from "./ClaudeLoginPrompt";
import {
  ClaudeSyncNoticeDialog,
  useClaudeSyncNotice,
} from "./ClaudeSyncNotice";
import { useClaudeLocalAccounts } from "./use-claude-local-accounts";
import { useClaudeLogin, type ClaudeLoginTarget } from "./use-claude-login";
import "./claude-accounts.css";

/**
 * The owner's Claude accounts, around one question: what does each place
 * run right now, and why. The owner makes one choice (an account, or each
 * computer's own Claude Code login) and it applies to every computer and
 * the cloud. Below it, every place shows the account it actually runs and
 * whether that is the choice or the computer's own login; a place without a
 * login for the chosen account says so and offers to sign it in, here, in
 * the cloud, or on another computer from this one.
 *
 * Stella keeps only identities. Every place signs in with Claude Code's own
 * `claude auth login`, on Anthropic's own page.
 */

const K = "settings.engineAccounts";
const C = "settings.engineAccounts.claude";

const sameEmail = (a: string | undefined, b: string | undefined) =>
  Boolean(a && b && a.trim().toLowerCase() === b.trim().toLowerCase());

type PlaceView = {
  key: string;
  kind: "this" | "device" | "cloud";
  name: string;
  deviceId?: string;
  online: boolean;
  cliInstalled: boolean | undefined;
  inUseEmail?: string;
  /** Something here is signed in, even when Claude Code didn't say who. */
  signedIn: boolean;
  reason?: "selected" | "own_login" | "other_login";
  ownLoginEmail?: string;
  missingChosen: boolean;
  /** This place reported anything at all about Claude Code. */
  reported: boolean;
};

export function ClaudeAccountsSection({
  settings,
  refreshing,
  cloudAvailable,
}: {
  settings: EngineSettings | undefined;
  refreshing: boolean;
  /** The owner's cloud can hold a sign-in (they are signed in to Stella). */
  cloudAvailable: boolean;
}) {
  const t = useT();
  const local = useClaudeLocalAccounts();
  const [deviceId, setDeviceId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const { reload: reloadLocal } = local;
  const devicesList = useBackendValue("devices.list", cloudAvailable ? {} : "skip");

  useEffect(() => {
    if (!local.available) return;
    let cancelled = false;
    void getDeviceIdOrNull().then((id) => {
      if (!cancelled) setDeviceId(id);
    });
    return () => {
      cancelled = true;
    };
  }, [local.available]);

  const syncNotice = useClaudeSyncNotice();
  const login = useClaudeLogin({
    onSignedIn: (result, target) => {
      syncNotice.announce();
      const place =
        target.place === "cloud"
          ? t(`${C}.cloud`)
          : target.place === "device"
            ? (target.deviceName ?? t(`${C}.otherComputer`))
            : t(`${C}.thisComputerUnnamed`);
      showToast({
        title: result.email
          ? t(`${C}.signedInOnAs`, { place, email: result.email })
          : t(`${C}.signedInOn`, { place }),
      });
      if (target.place === "local") void reloadLocal();
    },
  });

  const run = useCallback(
    async (action: () => Promise<unknown>, done?: string) => {
      setBusy(true);
      try {
        await action();
        if (done) showToast({ title: done });
      } catch (error) {
        showToast({
          title:
            error instanceof Error && error.message
              ? error.message
              : t(`${K}.errorGeneric`),
          variant: "error",
        });
      } finally {
        setBusy(false);
      }
    },
    [t],
  );

  const startLogin = (target: ClaudeLoginTarget) => void login.start(target);
  const canSignInHere = local.available && local.cliInstalled;
  const accounts = (settings?.connections ?? []).filter(
    (row): row is EngineConnection => row.provider === "anthropic",
  );
  const overview = settings?.claude;
  const chosenId = overview?.chosenAccountId ?? null;
  const chosen = accounts.find((account) => account.accountId === chosenId);
  const disabled = busy || refreshing;
  const devices: DeviceDestination[] = devicesList?.devices ?? [];
  const deviceOnline = (id: string) =>
    devicesList === undefined
      ? true
      : (devices.find((device) => device.deviceId === id)?.online ?? false);
  const deviceLabel = (id: string, fallback?: string) =>
    devices.find((device) => device.deviceId === id)?.label?.trim() ||
    fallback ||
    t(`${C}.otherComputer`);

  const localFor = (email: string | undefined): ClaudeLocalConfig | undefined =>
    local.configs.find(
      (config) => config.loggedIn && sameEmail(config.email, email),
    );
  const unlistedLocal = local.configs.filter(
    (config) =>
      config.loggedIn &&
      config.email &&
      !accounts.some((account) => sameEmail(account.email, config.email)),
  );
  const signedOutExtras = local.configs.filter(
    (config) => !config.isDefault && !config.loggedIn,
  );

  const choose = (accountId: string | null) => {
    const account = accounts.find((row) => row.accountId === accountId);
    void run(
      () => cloudEnginesApi.chooseClaudeAccount(accountId),
      accountId
        ? t(`${C}.chosenToast`, { email: account?.email ?? account?.label ?? "" })
        : t(`${C}.automaticToast`),
    );
  };

  // --- What each place runs ----------------------------------------------------

  const placeFromOverview = (place: ClaudePlaceStatus): PlaceView => ({
    key: place.kind === "cloud" ? "cloud" : `device:${place.deviceId}`,
    kind:
      place.kind === "cloud"
        ? "cloud"
        : place.deviceId === deviceId && local.available
          ? "this"
          : "device",
    name:
      place.kind === "cloud"
        ? t(`${C}.cloud`)
        : deviceLabel(place.deviceId ?? "", place.deviceName),
    ...(place.deviceId ? { deviceId: place.deviceId } : {}),
    online: place.kind === "cloud" ? true : deviceOnline(place.deviceId ?? ""),
    cliInstalled: place.cliInstalled,
    ...(place.inUse?.email ? { inUseEmail: place.inUse.email } : {}),
    signedIn: Boolean(place.inUse),
    ...(place.inUse ? { reason: place.inUse.reason } : {}),
    ...(place.ownLogin?.email ? { ownLoginEmail: place.ownLogin.email } : {}),
    missingChosen: place.missingChosen,
    reported: true,
  });

  const places: PlaceView[] = [];
  if (local.available) {
    const active = local.configs.find(
      (config) => config.configId === local.activeConfigId,
    );
    const own = local.configs.find(
      (config) => config.isDefault && config.loggedIn,
    );
    const thisName =
      (deviceId && devices.find((device) => device.deviceId === deviceId)?.label?.trim()) ||
      "";
    places.push({
      key: "this",
      kind: "this",
      name: thisName
        ? t(`${C}.thisComputer`, { name: thisName })
        : t(`${C}.thisComputerUnnamed`),
      ...(deviceId ? { deviceId } : {}),
      online: true,
      cliInstalled: local.loaded ? local.cliInstalled : undefined,
      ...(active?.email || active?.plan
        ? { inUseEmail: active.email ?? formatPlan(active.plan)! }
        : {}),
      signedIn: Boolean(active),
      ...(local.activeReason ? { reason: local.activeReason } : {}),
      ...(own?.email ? { ownLoginEmail: own.email } : {}),
      missingChosen: Boolean(chosen && !localFor(chosen.email)),
      reported: local.loaded,
    });
  }
  if (cloudAvailable) {
    const cloud = overview?.places.find((place) => place.kind === "cloud");
    places.push(
      cloud
        ? placeFromOverview(cloud)
        : {
            key: "cloud",
            kind: "cloud",
            name: t(`${C}.cloud`),
            online: true,
            cliInstalled: true,
            missingChosen: Boolean(chosen),
            signedIn: false,
            reported: true,
          },
    );
  }
  const seenDevices = new Set<string>(deviceId && local.available ? [deviceId] : []);
  for (const place of overview?.places ?? []) {
    if (place.kind !== "device" || !place.deviceId || seenDevices.has(place.deviceId)) {
      continue;
    }
    seenDevices.add(place.deviceId);
    places.push(placeFromOverview(place));
  }
  for (const device of devices) {
    if (seenDevices.has(device.deviceId)) continue;
    seenDevices.add(device.deviceId);
    places.push({
      key: `device:${device.deviceId}`,
      kind: "device",
      name: device.label?.trim() || t(`${C}.otherComputer`),
      deviceId: device.deviceId,
      online: device.online,
      cliInstalled: undefined,
      missingChosen: Boolean(chosen),
      signedIn: false,
      reported: false,
    });
  }

  const signInTarget = (
    place: PlaceView,
    email: string | undefined,
  ): ClaudeLoginTarget | null => {
    if (place.kind === "this") {
      return canSignInHere ? { place: "local", ...(email ? { email } : {}) } : null;
    }
    if (place.kind === "cloud") return { place: "cloud", ...(email ? { email } : {}) };
    if (!place.deviceId || !place.online || place.cliInstalled === false) return null;
    return {
      place: "device",
      deviceId: place.deviceId,
      deviceName: place.name,
      ...(email ? { email } : {}),
    };
  };

  const reasonText = (place: PlaceView): string => {
    if (place.reason === "selected") return t(`${C}.reasonSelected`);
    if (place.reason === "own_login") return t(`${C}.reasonOwnLogin`);
    return place.kind === "cloud" ? t(`${C}.reasonCloudLogin`) : t(`${C}.reasonOtherLogin`);
  };

  // --- Adding an account ---------------------------------------------------------

  const otherOnline = places.filter(
    (place) => place.kind === "device" && place.online && place.cliInstalled !== false,
  );
  const addTargets: Array<{ key: string; label: string; target: ClaudeLoginTarget | null }> = [
    ...(local.available
      ? [
          {
            key: "this",
            label: t(`${K}.addOnComputer`),
            target: canSignInHere ? ({ place: "local" } as const) : null,
          },
        ]
      : []),
    ...(cloudAvailable
      ? [{ key: "cloud", label: t(`${K}.addInCloud`), target: { place: "cloud" } as const }]
      : []),
    ...otherOnline.map((place) => ({
      key: place.key,
      label: t(`${C}.addOn`, { place: place.name }),
      target: signInTarget(place, undefined),
    })),
  ];
  const addControl =
    addTargets.length > 1 ? (
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            type="button"
            variant="ghost"
            className="pill-btn"
            disabled={disabled || login.open}
          >
            {t(`${K}.addClaude`)}
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" sideOffset={6} collisionPadding={12}>
          {addTargets.map((entry) => (
            <DropdownMenuItem
              key={entry.key}
              disabled={!entry.target}
              onSelect={() => entry.target && startLogin(entry.target)}
            >
              {entry.label}
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
    ) : (
      <Button
        type="button"
        variant="ghost"
        className="pill-btn"
        disabled={disabled || login.open || !addTargets[0]?.target}
        onClick={() => addTargets[0]?.target && startLogin(addTargets[0].target)}
      >
        {t(`${K}.addClaude`)}
      </Button>
    );

  // --- Account rows --------------------------------------------------------------

  const accountRow = (account: EngineConnection) => {
    const config = localFor(account.email);
    const inCloud = (account.places ?? []).some((place) => place.kind === "cloud");
    const tail: EngineAccountMenuItem[] = [];
    if (config && !config.isDefault) {
      tail.push({
        key: "out-here",
        label: t(`${K}.signOutComputer`),
        onSelect: () =>
          void run(() => local.signOut(config.configId), t(`${K}.signedOut`)),
      });
    }
    if (inCloud) {
      tail.push({
        key: "out-cloud",
        label: t(`${K}.signOutCloud`),
        onSelect: () =>
          void run(
            () => cloudEnginesApi.signOutClaudeCloud(account.accountId),
            t(`${K}.signedOut`),
          ),
      });
    }
    tail.push({
      key: "remove",
      label: t(`${K}.remove`),
      onSelect: () =>
        void run(
          () => cloudEnginesApi.disconnect("anthropic", account.accountId),
          t(`${K}.removed`),
        ),
    });
    const plan = formatPlan(account.plan);
    const active = account.accountId === chosenId;
    return (
      <EngineAccountRowView
        key={account.accountId}
        id={account.accountId}
        title={account.email ?? account.label}
        initials={accountInitials({
          label: account.label,
          ...(account.email ? { email: account.email } : {}),
        })}
        {...(plan ? { subtitle: plan } : {})}
        active={active}
        activeLabel={t(`${C}.chosen`)}
        busy={disabled}
        {...(active || !overview ? {} : { onPick: () => choose(account.accountId) })}
        items={[]}
        tail={tail}
      />
    );
  };

  return (
    <>
      <EngineAccountHeader
        title={t(`${K}.claudeTitle`)}
        description={t(`${C}.chooseNote`)}
        control={addControl}
      />
      <div className="claude-accounts" role="radiogroup" aria-label={t(`${K}.claudeTitle`)}>
        {overview ? (
          <EngineAccountRowView
            id="claude-automatic"
            title={t(`${C}.automatic`)}
            initials=""
            leading={
              <span className="claude-accounts__auto-icon" aria-hidden>
                <Globe size={16} />
              </span>
            }
            subtitle={t(`${C}.automaticHint`)}
            active={chosenId === null}
            activeLabel={t(`${C}.chosen`)}
            busy={disabled}
            {...(chosenId === null ? {} : { onPick: () => choose(null) })}
            items={[]}
          />
        ) : null}
        {accounts.map(accountRow)}
        {unlistedLocal.map((config) => {
          const plan = formatPlan(config.plan);
          return (
            <EngineAccountRowView
              key={`local:${config.configId}`}
              id={`local:${config.configId}`}
              title={config.email!}
              initials={accountInitials({ label: config.email!, email: config.email! })}
              {...(plan ? { subtitle: plan } : {})}
              active={false}
              busy={disabled}
              items={[]}
              tail={
                config.isDefault
                  ? []
                  : [
                      {
                        key: "out-here",
                        label: t(`${K}.signOutComputer`),
                        onSelect: () =>
                          void run(
                            () => local.signOut(config.configId),
                            t(`${K}.signedOut`),
                          ),
                      },
                    ]
              }
            />
          );
        })}
        {signedOutExtras.map((config) => (
          <EngineAccountRowView
            key={`local:${config.configId}`}
            id={`local:${config.configId}`}
            title={t(`${K}.signedOutLogin`)}
            initials="?"
            subtitle={t(`${K}.placeComputer`)}
            active={false}
            busy={disabled}
            items={[
              {
                key: "again",
                label: t(`${K}.signInAgain`),
                onSelect: () =>
                  startLogin({ place: "local", configId: config.configId }),
              },
            ]}
            tail={[
              {
                key: "remove",
                label: t(`${K}.remove`),
                onSelect: () => void run(() => local.signOut(config.configId)),
              },
            ]}
          />
        ))}
      </div>

      {places.length > 0 ? (
        <div className="claude-places" data-claude-places>
          <div className="claude-places__title">{t(`${C}.inUseTitle`)}</div>
          {places.map((place) => {
            const target = signInTarget(
              place,
              place.missingChosen ? chosen?.email : undefined,
            );
            const notInstalled = place.cliInstalled === false;
            const signedIn = place.signedIn;
            const status = !place.online
              ? t(`${C}.offline`)
              : notInstalled
                ? t(`${C}.cliMissing`)
                : !place.reported
                  ? place.kind === "this"
                    ? null
                    : t(`${C}.unknown`)
                  : !signedIn
                    ? t(`${C}.notSignedIn`)
                    : null;
            const needsSignIn =
              place.online &&
              !notInstalled &&
              (place.missingChosen || (!signedIn && place.reported));
            const showOwn =
              place.kind !== "cloud" &&
              place.ownLoginEmail &&
              !sameEmail(place.ownLoginEmail, place.inUseEmail);
            return (
              <div
                key={place.key}
                className="claude-place"
                data-claude-place={place.key}
                data-reason={place.reason}
                data-missing-chosen={place.missingChosen || undefined}
              >
                <span className="claude-place__icon" aria-hidden>
                  {place.kind === "cloud" ? <CloudIcon size={16} /> : <Monitor size={16} />}
                </span>
                <div className="claude-place__text">
                  <div className="claude-place__name">{place.name}</div>
                  {signedIn ? (
                    <div className="claude-place__account">
                      <span className="claude-place__email">{place.inUseEmail}</span>
                      <span className="claude-place__reason" data-reason={place.reason}>
                        {reasonText(place)}
                      </span>
                    </div>
                  ) : null}
                  {status ? <div className="claude-place__status">{status}</div> : null}
                  {showOwn ? (
                    <div className="claude-place__note">
                      {t(`${C}.ownLoginNote`, { email: place.ownLoginEmail! })}
                    </div>
                  ) : null}
                  {place.missingChosen && chosen?.email && place.online && !notInstalled ? (
                    <div className="claude-place__warn">
                      {t(signedIn ? `${C}.missingChosenFallback` : `${C}.missingChosen`, {
                        email: chosen.email,
                      })}
                    </div>
                  ) : null}
                </div>
                {needsSignIn && target ? (
                  <Button
                    type="button"
                    variant="ghost"
                    className="pill-btn"
                    disabled={disabled || login.open}
                    onClick={() => startLogin(target)}
                  >
                    {t(`${K}.signIn`)}
                  </Button>
                ) : null}
              </div>
            );
          })}
        </div>
      ) : null}

      <ClaudeLoginPrompt login={login} />
      <ClaudeSyncNoticeDialog
        open={syncNotice.open}
        onDismiss={syncNotice.dismiss}
      />
    </>
  );
}
