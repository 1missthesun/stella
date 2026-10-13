import { useMemo } from "react";
import { Alert, Platform, Pressable, StyleSheet, Text, View } from "react-native";
import type {
  ClaudePlaceStatus,
  EngineConnection,
  EngineSettings,
} from "@stella/contracts/backend/engines";
import { Icon } from "./Icon";
import { NativeMenu } from "./NativeMenu";
import type { NativeMenuItem } from "./NativeMenu.types";
import { getBackendClient, useBackendView } from "../lib/backend";
import { tapLight } from "../lib/haptics";
import { type Colors } from "../theme/colors";
import { fonts } from "../theme/fonts";
import { fadeHex } from "../theme/oklch";
import { useColors } from "../theme/theme-context";
import { useT } from "../i18n";
import type { EngineConnectOptions } from "./EngineAccountsSettings";

/**
 * Claude on the phone, around what each place runs. One choice (an account,
 * or each computer's own Claude Code login) applies to every computer and
 * the cloud. Below it every place shows the account it actually runs and
 * why, and a place without a login for the choice offers "Sign in": the
 * cloud signs in inside the owner's container, a computer runs its own
 * `claude auth login`, and either way the phone opens Anthropic's page and
 * sends back the code it shows.
 */

const C = "settings.engineAccounts.claude";

const sameEmail = (a: string | undefined, b: string | undefined) =>
  Boolean(a && b && a.trim().toLowerCase() === b.trim().toLowerCase());

type PlaceRow = {
  key: string;
  kind: "cloud" | "device";
  name: string;
  deviceId?: string;
  online: boolean;
  status: ClaudePlaceStatus | null;
};

export function ClaudeAccountsPanel({
  settings,
  busy,
  connecting,
  run,
  startConnect,
  onRemove,
  onSignOutCloud,
}: {
  settings: EngineSettings | undefined;
  busy: boolean;
  /** A sign-in is waiting for its code. */
  connecting: boolean;
  run: (action: () => Promise<unknown>) => Promise<boolean>;
  startConnect: (options?: EngineConnectOptions) => void;
  onRemove: (row: EngineConnection) => void;
  onSignOutCloud: (row: EngineConnection) => void;
}) {
  const colors = useColors();
  const t = useT();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const { value: devicesList } = useBackendView("devices.list", {});
  const accounts = (settings?.connections ?? []).filter(
    (row) => row.provider === "anthropic",
  );
  const overview = settings?.claude;
  const chosenId = overview?.chosenAccountId ?? null;
  const chosen = accounts.find((row) => row.accountId === chosenId);
  const devices = devicesList?.devices ?? [];

  const choose = (accountId: string | null) => {
    tapLight();
    void run(() =>
      getBackendClient().call(
        "engines.chooseClaudeAccount",
        accountId ? { accountId } : {},
      ),
    );
  };

  const places: PlaceRow[] = [];
  const cloud = overview?.places.find((place) => place.kind === "cloud") ?? null;
  places.push({ key: "cloud", kind: "cloud", name: t(`${C}.cloud`), online: true, status: cloud });
  const seen = new Set<string>();
  for (const place of overview?.places ?? []) {
    if (place.kind !== "device" || !place.deviceId || seen.has(place.deviceId)) continue;
    seen.add(place.deviceId);
    const device = devices.find((entry) => entry.deviceId === place.deviceId);
    places.push({
      key: `device:${place.deviceId}`,
      kind: "device",
      name: device?.label?.trim() || place.deviceName || t(`${C}.otherComputer`),
      deviceId: place.deviceId,
      online: device?.online ?? false,
      status: place,
    });
  }
  for (const device of devices) {
    if (seen.has(device.deviceId)) continue;
    seen.add(device.deviceId);
    places.push({
      key: `device:${device.deviceId}`,
      kind: "device",
      name: device.label?.trim() || t(`${C}.otherComputer`),
      deviceId: device.deviceId,
      online: device.online,
      status: null,
    });
  }

  const signIn = (place: PlaceRow, email?: string) =>
    startConnect({
      ...(email ? { email } : {}),
      ...(place.kind === "device" && place.deviceId ? { deviceId: place.deviceId } : {}),
    });

  const canSignIn = (place: PlaceRow) =>
    place.kind === "cloud" || (place.online && place.status?.cliInstalled !== false);

  const addTargets = places.filter(canSignIn);

  const reasonText = (place: PlaceRow): string => {
    const reason = place.status?.inUse?.reason;
    if (reason === "selected") return t(`${C}.reasonSelected`);
    if (reason === "own_login") return t(`${C}.reasonOwnLogin`);
    return place.kind === "cloud" ? t(`${C}.reasonCloudLogin`) : t(`${C}.reasonOtherLogin`);
  };

  const accountActions = (row: EngineConnection): NativeMenuItem[] => {
    const inCloud = (row.places ?? []).some((place) => place.kind === "cloud");
    return [
      ...(inCloud
        ? [
            {
              id: "sign-out-cloud",
              title: t("mobile.engineAccounts.signOutCloud"),
              systemImage: "icloud.slash" as const,
              onPress: () => onSignOutCloud(row),
            },
          ]
        : []),
      {
        id: "remove",
        title: t("mobile.engineAccounts.remove"),
        systemImage: "trash" as const,
        separatorBefore: inCloud,
        onPress: () => onRemove(row),
      },
    ];
  };

  const openFallback = (title: string, items: NativeMenuItem[]) => {
    Alert.alert(title, undefined, [
      ...items.map((item) => ({ text: item.title, onPress: item.onPress })),
      { text: t("mobile.common.cancel"), style: "cancel" as const },
    ]);
  };

  const choiceRow = (
    key: string,
    label: string,
    detail: string | undefined,
    selected: boolean,
    onPress: () => void,
    menu?: NativeMenuItem[],
  ) => (
    <Pressable
      key={key}
      onPress={selected ? undefined : onPress}
      disabled={busy}
      accessibilityRole="radio"
      accessibilityState={{ selected, disabled: busy }}
      accessibilityLabel={label}
      style={({ pressed }) => [styles.choice, pressed && !selected && styles.pressed]}
    >
      <View style={[styles.radio, selected && styles.radioOn]}>
        {selected ? <View style={styles.radioDot} /> : null}
      </View>
      <View style={styles.choiceText}>
        <Text
          style={[styles.choiceLabel, selected && styles.choiceChosen]}
          numberOfLines={1}
          ellipsizeMode="middle"
        >
          {label}
        </Text>
        {detail ? (
          <Text style={styles.detail} numberOfLines={2}>
            {detail}
          </Text>
        ) : null}
      </View>
      {menu && menu.length > 0 ? (
        Platform.OS === "ios" ? (
          <NativeMenu
            label={<Icon name="more-horizontal" size={18} color={colors.textMuted} />}
            accessibilityLabel={t("mobile.engineAccounts.moreLabel", { name: label })}
            width={40}
            height={36}
            circular
            disabled={busy}
            items={menu}
            onFallbackPress={() => openFallback(label, menu)}
          />
        ) : (
          <Pressable
            onPress={() => openFallback(label, menu)}
            hitSlop={8}
            accessibilityRole="button"
            accessibilityLabel={t("mobile.engineAccounts.moreLabel", { name: label })}
          >
            <Icon name="more-horizontal" size={18} color={colors.textMuted} />
          </Pressable>
        )
      ) : null}
    </Pressable>
  );

  const addItems: NativeMenuItem[] = addTargets.map((place) => ({
    id: place.key,
    title: place.kind === "cloud" ? t("settings.engineAccounts.addInCloud") : t(`${C}.addOn`, { place: place.name }),
    systemImage: place.kind === "cloud" ? "icloud" : "desktopcomputer",
    onPress: () => signIn(place),
  }));

  return (
    <View style={styles.root} testID="claude-accounts-panel">
      <View accessibilityRole="radiogroup">
        {overview
          ? choiceRow(
              "automatic",
              t("mobile.engineAccounts.claudeDefault"),
              t(`${C}.automaticHint`),
              chosenId === null,
              () => choose(null),
            )
          : null}
        {accounts.map((row) =>
          choiceRow(
            row.accountId,
            row.email ?? row.label,
            row.plan ? `${row.plan.charAt(0).toUpperCase()}${row.plan.slice(1)}` : undefined,
            row.accountId === chosenId,
            () => choose(row.accountId),
            accountActions(row),
          ),
        )}
      </View>
      <Text style={styles.note}>{t(`${C}.chooseNote`)}</Text>

      <Text style={styles.sectionLabel} accessibilityRole="header">
        {t(`${C}.inUseTitle`)}
      </Text>
      {places.map((place) => {
        const status = place.status;
        const inUse = status?.inUse ?? null;
        const missingChosen = status ? status.missingChosen : Boolean(chosen);
        const notInstalled = status?.cliInstalled === false;
        const statusText = !place.online
          ? t(`${C}.offline`)
          : notInstalled
            ? t(`${C}.cliMissing`)
            : !status && place.kind === "device"
              ? t(`${C}.unknown`)
              : !inUse
                ? t(`${C}.notSignedIn`)
                : null;
        const showOwn =
          place.kind === "device" &&
          status?.ownLogin?.email &&
          !sameEmail(status.ownLogin.email, inUse?.email);
        const needsSignIn =
          canSignIn(place) && (missingChosen || (!inUse && (status !== null || place.kind === "cloud")));
        return (
          <View
            key={place.key}
            style={styles.place}
            testID={`claude-place-${place.kind === "cloud" ? "cloud" : place.deviceId}`}
          >
            <View style={styles.placeIcon}>
              <Icon
                name={place.kind === "cloud" ? "cloud" : "monitor"}
                size={16}
                color={colors.text}
              />
            </View>
            <View style={styles.placeText}>
              <Text style={styles.placeName} numberOfLines={1}>
                {place.name}
              </Text>
              {inUse ? (
                <>
                  <Text style={styles.placeAccount} numberOfLines={1} ellipsizeMode="middle">
                    {inUse.email ?? ""}
                  </Text>
                  <Text style={[styles.reason, inUse.reason === "selected" && styles.reasonChosen]}>
                    {reasonText(place)}
                  </Text>
                </>
              ) : null}
              {statusText ? <Text style={styles.detail}>{statusText}</Text> : null}
              {showOwn ? (
                <Text style={styles.detail}>
                  {t(`${C}.ownLoginNote`, { email: status!.ownLogin!.email! })}
                </Text>
              ) : null}
              {missingChosen && chosen?.email && place.online && !notInstalled ? (
                <Text style={styles.warn}>
                  {t(inUse ? `${C}.missingChosenFallback` : `${C}.missingChosen`, {
                    email: chosen.email,
                  })}
                </Text>
              ) : null}
            </View>
            {needsSignIn ? (
              <Pressable
                onPress={() => signIn(place, missingChosen ? chosen?.email : undefined)}
                disabled={busy || connecting}
                accessibilityRole="button"
                accessibilityLabel={`${t("settings.engineAccounts.signIn")}: ${place.name}`}
                style={({ pressed }) => [
                  styles.signIn,
                  (busy || connecting) && styles.disabled,
                  pressed && styles.pressed,
                ]}
              >
                <Text style={styles.signInLabel}>{t("settings.engineAccounts.signIn")}</Text>
              </Pressable>
            ) : null}
          </View>
        );
      })}

      {Platform.OS === "ios" ? (
        <NativeMenu
          plain
          label={
            <View style={styles.addRow}>
              <Icon name="plus" size={16} color={colors.textInteractive} />
              <Text style={styles.addLabel}>{t("mobile.engineAccounts.connectClaude")}</Text>
            </View>
          }
          accessibilityLabel={t("mobile.engineAccounts.connectClaude")}
          width={260}
          height={44}
          disabled={busy || connecting}
          items={addItems}
          onFallbackPress={() => openFallback(t("mobile.engineAccounts.connectClaude"), addItems)}
        />
      ) : (
        <Pressable
          onPress={() => openFallback(t("mobile.engineAccounts.connectClaude"), addItems)}
          disabled={busy || connecting}
          accessibilityRole="button"
          style={({ pressed }) => [styles.addRow, pressed && styles.pressed]}
        >
          <Icon name="plus" size={16} color={colors.textInteractive} />
          <Text style={styles.addLabel}>{t("mobile.engineAccounts.connectClaude")}</Text>
        </Pressable>
      )}
    </View>
  );
}

const makeStyles = (colors: Colors) =>
  StyleSheet.create({
    root: { paddingBottom: 4 },
    choice: {
      alignItems: "center",
      flexDirection: "row",
      gap: 12,
      minHeight: 48,
      paddingVertical: 8,
    },
    pressed: { opacity: 0.55 },
    disabled: { opacity: 0.5 },
    radio: {
      alignItems: "center",
      borderColor: fadeHex(colors.text, 0.35),
      borderRadius: 10,
      borderWidth: 1.5,
      height: 20,
      justifyContent: "center",
      width: 20,
    },
    radioOn: { borderColor: colors.accent },
    radioDot: {
      backgroundColor: colors.accent,
      borderRadius: 5,
      height: 10,
      width: 10,
    },
    choiceText: { flex: 1, gap: 2 },
    choiceLabel: {
      color: colors.text,
      fontFamily: fonts.sans.medium,
      fontSize: 16,
      letterSpacing: -0.2,
    },
    choiceChosen: { fontFamily: fonts.sans.semiBold },
    detail: {
      color: colors.textMuted,
      fontFamily: fonts.sans.regular,
      fontSize: 13,
      lineHeight: 18,
    },
    note: {
      color: colors.textMuted,
      fontFamily: fonts.sans.regular,
      fontSize: 13,
      lineHeight: 18,
      marginTop: 4,
    },
    sectionLabel: {
      color: colors.textMuted,
      fontFamily: fonts.sans.medium,
      fontSize: 13,
      marginBottom: 4,
      marginTop: 22,
    },
    place: {
      alignItems: "flex-start",
      flexDirection: "row",
      gap: 12,
      paddingVertical: 10,
    },
    placeIcon: {
      alignItems: "center",
      backgroundColor: fadeHex(colors.text, 0.07),
      borderRadius: 8,
      height: 30,
      justifyContent: "center",
      width: 30,
    },
    placeText: { flex: 1, gap: 2 },
    placeName: {
      color: colors.text,
      fontFamily: fonts.sans.semiBold,
      fontSize: 15,
      letterSpacing: -0.2,
    },
    placeAccount: {
      color: colors.text,
      fontFamily: fonts.sans.regular,
      fontSize: 14,
    },
    reason: {
      color: colors.textMuted,
      fontFamily: fonts.sans.regular,
      fontSize: 13,
      lineHeight: 18,
    },
    reasonChosen: { color: colors.accent },
    warn: {
      color: colors.danger,
      fontFamily: fonts.sans.regular,
      fontSize: 13,
      lineHeight: 18,
    },
    signIn: {
      alignSelf: "center",
      borderColor: fadeHex(colors.text, 0.18),
      borderRadius: 16,
      borderWidth: StyleSheet.hairlineWidth * 2,
      paddingHorizontal: 14,
      paddingVertical: 7,
    },
    signInLabel: {
      color: colors.text,
      fontFamily: fonts.sans.medium,
      fontSize: 14,
    },
    addRow: {
      alignItems: "center",
      flexDirection: "row",
      gap: 8,
      minHeight: 44,
      marginTop: 6,
    },
    addLabel: {
      color: colors.textInteractive,
      fontFamily: fonts.sans.medium,
      fontSize: 15,
    },
  });
