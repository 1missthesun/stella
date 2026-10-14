import { useCallback, useState } from "react";
import { Alert, Pressable, View } from "react-native";
import { Text } from "../Text";
import { useFocusEffect, useRouter } from "expo-router";
import { Icon } from "../Icon";
import type { SettingsStyles } from "./settings-styles";
import type { Colors } from "../../theme/colors";
import { tapLight } from "../../lib/haptics";
import { selfHostServersAvailable } from "../../lib/native-capabilities";
import {
  launchServer,
  listServers,
  type ServerEntry,
} from "../../lib/server-registry";
import { removeServer, switchToServer } from "../../lib/server-switch";
import { useT } from "../../i18n";

const hostOf = (entry: ServerEntry) =>
  entry.kind === "hosted" ? "stella.sh" : new URL(entry.origin).host;

export function ServerSection({
  styles,
  colors,
}: {
  styles: SettingsStyles;
  colors: Colors;
}) {
  const t = useT();
  const router = useRouter();
  const [servers, setServers] = useState<ServerEntry[]>(() => listServers());
  const [busy, setBusy] = useState(false);

  useFocusEffect(
    useCallback(() => {
      setServers(listServers());
    }, []),
  );

  if (!selfHostServersAvailable) return null;

  const nameOf = (entry: ServerEntry) =>
    entry.kind === "hosted" ? t("mobile.selfHost.hostedName") : entry.name;

  const confirmSwitch = (entry: ServerEntry) => {
    tapLight();
    Alert.alert(
      t("mobile.selfHost.switchTitle", { name: nameOf(entry) }),
      t("mobile.selfHost.switchBody"),
      [
        { text: t("mobile.common.cancel"), style: "cancel" },
        {
          text: t("mobile.selfHost.switchButton"),
          onPress: () => {
            setBusy(true);
            void switchToServer(entry.id).finally(() => setBusy(false));
          },
        },
      ],
    );
  };

  const confirmRemove = (entry: ServerEntry) => {
    if (entry.kind === "hosted") return;
    tapLight();
    Alert.alert(
      t("mobile.selfHost.removeTitle", { name: nameOf(entry) }),
      t("mobile.selfHost.removeBody"),
      [
        { text: t("mobile.common.cancel"), style: "cancel" },
        {
          text: t("mobile.selfHost.removeButton"),
          style: "destructive",
          onPress: () => {
            setBusy(true);
            void removeServer(entry.id)
              .then(() => setServers(listServers()))
              .finally(() => setBusy(false));
          },
        },
      ],
    );
  };

  return (
    <View style={styles.section}>
      <Text style={styles.sectionLabel}>{t("mobile.selfHost.serverSection")}</Text>
      <View style={styles.group}>
        {servers.map((entry, index) => {
          const active = entry.id === launchServer.id;
          return (
            <View
              key={entry.id}
              style={[styles.row, index > 0 && styles.rowDivider]}
            >
              <Pressable
                testID={`server-row-${entry.id}`}
                accessibilityRole="button"
                accessibilityState={{ selected: active, disabled: busy }}
                accessibilityLabel={nameOf(entry)}
                disabled={busy || active}
                onPress={() => confirmSwitch(entry)}
                style={({ pressed }) => [
                  { flex: 1, flexDirection: "row", alignItems: "center" },
                  pressed && { opacity: 0.6 },
                ]}
              >
              <Icon
                name={entry.kind === "hosted" ? "cloud" : "monitor"}
                size={18}
                color={colors.textMuted}
                style={styles.rowIcon}
              />
              <View style={styles.rowCopy}>
                <Text style={styles.rowLabel} numberOfLines={1}>
                  {nameOf(entry)}
                </Text>
                <Text style={styles.rowSub} numberOfLines={1}>
                  {entry.kind === "hosted"
                    ? t("mobile.selfHost.hostedSub")
                    : t("mobile.selfHost.selfHostedSub", { host: hostOf(entry) })}
                </Text>
              </View>
              {active ? (
                <Icon name="check" size={16} color={colors.accent} />
              ) : null}
              </Pressable>
              {entry.kind === "self-hosted" ? (
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={t("mobile.selfHost.removeButtonA11y", {
                    name: nameOf(entry),
                  })}
                  hitSlop={8}
                  disabled={busy}
                  onPress={() => confirmRemove(entry)}
                  style={{ marginLeft: 12 }}
                >
                  <Icon name="trash" size={16} color={colors.textMuted} />
                </Pressable>
              ) : null}
            </View>
          );
        })}
        <Pressable
          testID="server-add"
          accessibilityRole="button"
          accessibilityLabel={t("mobile.selfHost.addServer")}
          disabled={busy}
          onPress={() => {
            tapLight();
            router.push("/connect-server");
          }}
          style={({ pressed }) => [
            styles.row,
            styles.rowDivider,
            pressed && styles.rowPressed,
          ]}
        >
          <Icon name="plus" size={18} color={colors.accent} style={styles.rowIcon} />
          <Text style={[styles.rowLabel, { flex: 1, color: colors.accent }]}>
            {t("mobile.selfHost.addServer")}
          </Text>
        </Pressable>
      </View>
    </View>
  );
}
