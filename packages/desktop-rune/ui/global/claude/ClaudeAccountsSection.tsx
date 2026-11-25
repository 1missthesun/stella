import { Button, DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger, showToast } from "../../kit/compat";
import { usePill } from "../shared/pill.styles";
import { serverNow } from "@stella/contracts/server-clock";
import { useCallback, useEffect, useState } from "react";
import type {
  ClaudePlaceStatus,
  EngineConnection,
  EngineSettings,
} from "@stella/contracts/backend/engines";
import type { DeviceDestination } from "@stella/contracts/turn-plane/placement";
import {
  CLAUDE_LOGIN_WARN_BEFORE_MS,
  type ClaudeLocalConfig,
} from "@stella/contracts/claude-local-accounts";
import { useLocale, useT } from "@/shared/i18n";
import { getDeviceIdOrNull } from "@/platform/electron/device-id";
import { useBackendValue } from "@/platform/backend/use-backend-view";
import { cloudEnginesApi } from "@/features/cloud/cloud-engines-api";
import { formatPlan } from "../cloud/EngineAccountRow";
import {
  AiEmptyName,
  AiDetailsGroup,
  AiInUse,
  AiLink,
  AiNote,
  AiPrimaryAccount,
  AiProviderSection,
  AiRow,
  type AiMenuItem,
} from "../cloud/AiProviderSection";
import { openExternalUrl } from "@/platform/electron/open-external";
import { ClaudeLoginPrompt } from "./ClaudeLoginPrompt";
import {
  ClaudeSyncNoticeDialog,
  useClaudeSyncNotice,
} from "./ClaudeSyncNotice";
import { useClaudeLocalAccounts } from "@/features/claude/use-claude-local-accounts";
import { useClaudeLogin, type ClaudeLoginTarget } from "@/features/claude/use-claude-login";
import { useClaudeInstallThenSignIn } from "@/features/claude/use-claude-cli-install";
import { ClaudeCliInstallStatus } from "./ClaudeCliInstallStatus";

const K = "settings.engineAccounts";
const C = "settings.engineAccounts.claude";

const CLAUDE_USAGE_URL = "https://claude.ai/settings/usage";
const openClaudeUsage = () => openExternalUrl(CLAUDE_USAGE_URL);

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
  signedIn: boolean;
  reason?: "selected" | "own_login" | "other_login";
  ownLoginEmail?: string;
  missingChosen: boolean;
  reported: boolean;
  loginEnd?: { state: "ending" | "ended"; endsAt?: number; email?: string };
};

export function ClaudeAccountsSection({
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
    <Button variant="ghost" className="pill-btn" disabled={useEngineDisabled} onClick={onUseEngine}>
      {t("settings.engineAccounts.use")}
    </Button>
  ) : null;
  const local = useClaudeLocalAccounts();
  const locale = useLocale();
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
  const install = useClaudeInstallThenSignIn({
    reload: reloadLocal,
    signIn: () => void login.start({ place: "local", configId: "default" }),
  });
  const offerInstall =
    local.available && local.loaded && !local.cliInstalled && install.available;
  const installHere = () => void install.run();
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

  const cloudLoginEnd = (place: ClaudePlaceStatus): PlaceView["loginEnd"] => {
    if (place.kind !== "cloud" || !place.inUse) return undefined;
    const login = accounts
      .find((row) => row.accountId === place.inUse?.accountId)
      ?.places?.find((entry) => entry.kind === "cloud");
    if (!login || login.kind !== "cloud") return undefined;
    const email = place.inUse.email;
    const now = serverNow();
    if (login.loginEnded || (login.loginEndsAt !== undefined && login.loginEndsAt <= now)) {
      return { state: "ended", ...(email ? { email } : {}) };
    }
    if (login.loginEndsAt !== undefined && login.loginEndsAt - now <= CLAUDE_LOGIN_WARN_BEFORE_MS) {
      return { state: "ending", endsAt: login.loginEndsAt, ...(email ? { email } : {}) };
    }
    return undefined;
  };

  const formatEnd = (at: number | undefined): string =>
    at === undefined
      ? ""
      : new Intl.DateTimeFormat(locale, {
          weekday: "long",
          month: "long",
          day: "numeric",
          hour: "numeric",
          minute: "2-digit",
        }).format(new Date(at));

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
    ...(cloudLoginEnd(place) ? { loginEnd: cloudLoginEnd(place) } : {}),
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
      ...(local.attention
        ? {
            loginEnd: {
              state: local.attention.state,
              ...(local.attention.expiresAt !== undefined ? { endsAt: local.attention.expiresAt } : {}),
              ...(local.attention.email ? { email: local.attention.email } : {}),
            },
          }
        : {}),
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

  const placeShort = (place: PlaceView) =>
    place.kind === "this"
      ? t(`${C}.thisComputerUnnamed`)
      : place.kind === "cloud"
        ? t(`${C}.cloudStart`)
        : place.name;
  const placeInline = (place: PlaceView) =>
    place.kind === "this"
      ? t(`${C}.thisComputerInline`)
      : place.kind === "cloud"
        ? t(`${C}.cloudInline`)
        : place.name;

  const otherOnline = places.filter(
    (place) => place.kind === "device" && place.online && place.cliInstalled !== false,
  );
  const addTargets: Array<{
    key: string;
    label: string;
    target: ClaudeLoginTarget | null;
    run?: () => void;
  }> = [
    ...(local.available
      ? [
          {
            key: "this",
            label: t(`${K}.addOnComputer`),
            target: canSignInHere ? ({ place: "local" } as const) : null,
            ...(offerInstall ? { run: installHere } : {}),
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
  const addControl = (label: string) =>
    addTargets.length > 1 ? (
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" className="pill-btn" disabled={disabled || login.open || install.installing}>
            {label}
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" sideOffset={6} collisionPadding={12}>
          {addTargets.map((entry) => (
            <DropdownMenuItem key={entry.key} disabled={!entry.target && !entry.run} onSelect={() =>
                entry.target ? startLogin(entry.target) : entry.run?.()
              }>
              {entry.label}
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
    ) : (
      <Button variant="ghost" className="pill-btn" disabled={
          disabled ||
          login.open ||
          install.installing ||
          (!addTargets[0]?.target && !addTargets[0]?.run)
        } onClick={() =>
          addTargets[0]?.target ? startLogin(addTargets[0].target) : addTargets[0]?.run?.()
        }>
        {label}
      </Button>
    );

  const accountMenu = (account: EngineConnection): AiMenuItem[] => {
    const config = localFor(account.email);
    const inCloud = (account.places ?? []).some((place) => place.kind === "cloud");
    const items: AiMenuItem[] = [];
    if (config && !config.isDefault) {
      items.push({
        key: "out-here",
        label: t(`${K}.signOutComputer`),
        onSelect: () =>
          void run(() => local.signOut(config.configId), t(`${K}.signedOut`)),
      });
    }
    if (inCloud) {
      items.push({
        key: "out-cloud",
        label: t(`${K}.signOutCloud`),
        onSelect: () =>
          void run(
            () => cloudEnginesApi.signOutClaudeCloud(account.accountId),
            t(`${K}.signedOut`),
          ),
      });
    }
    items.push({
      key: "remove",
      label: t(`${K}.remove`),
      onSelect: () =>
        void run(
          () => cloudEnginesApi.disconnect("anthropic", account.accountId),
          t(`${K}.removed`),
        ),
    });
    return items;
  };

  const thisPlace = places.find((place) => place.kind === "this");
  const activeLocal = local.configs.find((config) => config.configId === local.activeConfigId);
  const usingOwn = !chosen;
  const primaryEmail = chosen
    ? (chosen.email ?? chosen.label)
    : (thisPlace?.inUseEmail ??
      places.find((place) => place.signedIn && place.inUseEmail)?.inUseEmail);
  const primaryPlan = formatPlan(chosen ? chosen.plan : activeLocal?.plan);
  const reachable = places.filter((place) => place.online && place.reported);
  const usingIt = reachable.filter((place) =>
    chosen ? place.signedIn && !place.missingChosen : place.signedIn,
  );
  const where = !primaryEmail
    ? null
    : usingOwn
      ? thisPlace?.signedIn
        ? t(`${C}.ownLoginHere`)
        : usingIt.length > 0
          ? t(`${C}.usedOn`, { places: usingIt.map((place) => placeInline(place)).join(", ") })
          : null
      : usingIt.length === reachable.length && reachable.length > 1
        ? t(`${C}.everywhere`)
        : usingIt.length > 0
          ? t(`${C}.usedOn`, { places: usingIt.map((place) => placeInline(place)).join(", ") })
          : null;

  const noteFor = (place: PlaceView): { text: string; target: ClaudeLoginTarget | null } | null => {
    if (!place.online || place.cliInstalled === false) return null;
    const target = signInTarget(
      place,
      place.missingChosen ? chosen?.email : place.loginEnd?.email,
    );
    if (place.loginEnd?.state === "ended") {
      return { text: t(`${C}.noteEnded`, { place: placeShort(place) }), target };
    }
    if (place.loginEnd?.state === "ending") {
      return {
        text: t(`${C}.noteEnding`, { place: placeShort(place), date: formatEnd(place.loginEnd.endsAt) }),
        target,
      };
    }
    if (place.missingChosen && chosen) {
      return {
        text: t(`${C}.noteMissingChosen`, { place: placeShort(place), email: chosen.email ?? chosen.label }),
        target,
      };
    }
    if (!place.signedIn && place.reported) {
      return { text: t(`${C}.noteSignedOut`, { place: placeShort(place) }), target };
    }
    return null;
  };
  const notes = places
    .map((place) => ({ place, note: noteFor(place) }))
    .filter((entry): entry is { place: PlaceView; note: { text: string; target: ClaudeLoginTarget | null } } =>
      Boolean(entry.note),
    );
  const installNote = thisPlace?.cliInstalled === false && offerInstall;
  const signInButton = (target: ClaudeLoginTarget | null) =>
    target ? (
      <Button variant="ghost" className="pill-btn" disabled={disabled || login.open} onClick={() => startLogin(target)}>
        {t(`${K}.signIn`)}
      </Button>
    ) : null;
  const installButton =
    !install.installing && install.state.status !== "error" ? (
      <Button variant="ghost" className="pill-btn" disabled={disabled || login.open} onClick={installHere}>
        {t("claudeInstall.install")}
      </Button>
    ) : null;

  const connected = Boolean(primaryEmail);
  const accountCount = accounts.length + unlistedLocal.length;

  const inUseRow = (account: (typeof accounts)[number]) => account.accountId === chosenId;
  const placeMeta = (place: PlaceView, status: string) => {
    if (place.loginEnd?.state === "ended") return `${status} · ${t(`${C}.rowEnded`)}`;
    if (place.loginEnd?.state === "ending") {
      return `${status} · ${t(`${C}.rowEnding`, { date: formatEnd(place.loginEnd.endsAt) })}`;
    }
    if (place.missingChosen && chosen && place.signedIn && place.inUseEmail) {
      return t(`${C}.rowNotChosen`, { email: place.inUseEmail, chosen: chosen.email ?? chosen.label });
    }
    return status;
  };

  const details = (
    <>
      <AiDetailsGroup label={t(`${K}.accountsLabel`)}>
        {accounts.map((account) => (
          <AiRow key={account.accountId} name={account.email ?? account.label} meta={formatPlan(account.plan)} {...(inUseRow(account)
              ? { inUseLabel: t(`${K}.inUse`) }
              : account.accountId !== chosenId && overview
                ? { onUse: () => choose(account.accountId), useLabel: t(`${K}.use`) }
                : {})} menuLabel={t(`${K}.moreLabel`, { name: account.email ?? account.label })} menu={accountMenu(account)} busy={disabled} />
        ))}
        {unlistedLocal.map((config) => (
          <AiRow key={`local:${config.configId}`} name={config.email!} meta={formatPlan(config.plan)} menuLabel={t(`${K}.moreLabel`, { name: config.email! })} menu={
              config.isDefault
                ? []
                : [
                    {
                      key: "out-here",
                      label: t(`${K}.signOutComputer`),
                      onSelect: () =>
                        void run(() => local.signOut(config.configId), t(`${K}.signedOut`)),
                    },
                  ]
            } busy={disabled} />
        ))}
        {signedOutExtras.map((config) => (
          <AiRow key={`local:${config.configId}`} name={t(`${K}.signedOutLogin`)} meta={t(`${K}.placeComputer`)} busy={disabled} menuLabel={t(`${K}.moreLabel`, { name: t(`${K}.signedOutLogin`) })} menu={[
              {
                key: "again",
                label: t(`${K}.signInAgain`),
                onSelect: () => startLogin({ place: "local", configId: config.configId }),
              },
              {
                key: "remove",
                label: t(`${K}.remove`),
                onSelect: () => void run(() => local.signOut(config.configId)),
              },
            ]} />
        ))}
        {overview ? (
          <AiRow name={t(`${C}.ownLogin`)} meta={t(`${C}.ownLoginHint`)} {...(chosenId === null ? { inUseLabel: t(`${K}.inUse`) } : {})} {...(chosenId !== null ? { onUse: () => choose(null), useLabel: t(`${K}.use`) } : {})} busy={disabled} />
        ) : null}
      </AiDetailsGroup>
      {places.length > 0 ? (
        <AiDetailsGroup label={t(`${K}.computersLabel`)}>
          {places.map((place) => {
            const note = noteFor(place);
            const status = !place.online
              ? t(`${C}.offline`)
              : place.cliInstalled === false
                ? t(`${C}.cliMissing`)
                : place.signedIn
                  ? place.inUseEmail
                  : place.reported
                    ? t(`${C}.notSignedIn`)
                    : t(`${C}.unknown`);
            return (
              <AiRow key={place.key} name={place.name} meta={placeMeta(place, status ?? "")} busy={disabled} {...(place.kind === "this" && installNote
                  ? {
                      extra: (
                        <col w="full" mt={install.state.status === "installing" || install.state.status === "error" ? 8 : 0} maxW={420}>
                          <ClaudeCliInstallStatus state={install.state} onRetry={installHere} />
                        </col>
                      ),
                    }
                  : {})}>
                {place.kind === "this" && installNote ? installButton : note ? signInButton(note.target) : null}
              </AiRow>
            );
          })}
        </AiDetailsGroup>
      ) : null}
    </>
  );

  return (
    <>
      <AiProviderSection id="claude" titleKey={`${K}.claudeTitle`} {...(connected ? { action: addControl(t(`${K}.addAccount`)) } : {})} details={connected || accountCount > 0 ? details : undefined} detailsLabel={t(`${K}.detailsLabel`)} notes={
          <>
            {installNote ? (
              <AiNote action={installButton}>{t(`${K}.cliMissing`)}</AiNote>
            ) : null}
            {installNote && install.state.status !== "idle" ? (
              <col w="full" mt={install.state.status === "installing" || install.state.status === "error" ? 8 : 0} maxW={420}>
                <ClaudeCliInstallStatus state={install.state} onRetry={installHere} />
              </col>
            ) : null}
            {connected
              ? notes
                  .filter(({ place }) => !place.signedIn || place.loginEnd)
                  .slice(0, 2)
                  .map(({ place, note }) => (
                  <AiNote key={place.key} action={signInButton(note.target)}>
                    {note.text}
                  </AiNote>
                ))
              : null}
          </>
        }>
        {connected ? (
          <AiPrimaryAccount name={primaryEmail} meta={
              <>
                {[primaryPlan, where].filter(Boolean).join(" · ") || null}
                <AiLink label={t(`${K}.manageUsage`)} onClick={openClaudeUsage} external />
              </>
            } {...(engineInUse
              ? { status: <AiInUse label={t(`${K}.inUse`)} /> }
              : useEngineButton
                ? { status: useEngineButton }
                : {})} />
        ) : (
          <AiPrimaryAccount name={<AiEmptyName>{t(`${K}.notConnected`)}</AiEmptyName>} trailing={installNote ? null : addControl(t(`${K}.signIn`))} />
        )}
      </AiProviderSection>

      <ClaudeLoginPrompt login={login} />
      <ClaudeSyncNoticeDialog open={syncNotice.open} onDismiss={syncNotice.dismiss} />
    </>
  );
}
