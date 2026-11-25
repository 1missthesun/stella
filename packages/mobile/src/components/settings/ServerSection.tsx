import { useCallback, useState } from "react";
import { Alert, Pressable, View } from "react-native";
import { Text } from "../Text";
import { useFocusEffect, useRouter } from "expo-router";
import { Icon } from "../Icon";
import { Dot, Hairline, SectionLabel, TextAction } from "../chat-settings/kit";
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
  embedded = false,
}: {
  styles: SettingsStyles;
  colors: Colors;
  embedded?: boolean;
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
    <View style={embedded ? styles.sectionFirst : styles.section}>
      {embedded ? null : (
        <SectionLabel>{t("mobile.selfHost.serverSection")}</SectionLabel>
      )}
      <View style={styles.group}>
        {servers.map((entry) => {
          const active = entry.id === launchServer.id;
          return (
            <View key={entry.id} style={styles.row}>
              <Pressable
                testID={`server-row-${entry.id}`}
                accessibilityRole="button"
                accessibilityState={{ selected: active, disabled: busy }}
                accessibilityLabel={nameOf(entry)}
                disabled={busy || active}
                onPress={() => confirmSwitch(entry)}
                style={({ pressed }) => [
                  {
                    flex: 1,
                    flexDirection: "row",
                    alignItems: "center",
                    gap: 12,
                    minWidth: 0,
                  },
                  pressed && styles.rowPressed,
                ]}
              >
                <Icon
                  name={entry.kind === "hosted" ? "cloud" : "monitor"}
                  size={20}
                  color={colors.textMuted}
                  style={styles.rowIcon}
                />
                <View style={styles.rowCopy}>
                  <View
                    style={{
                      flexDirection: "row",
                      alignItems: "center",
                      gap: 8,
                    }}
                  >
                    <Text style={styles.rowLabel} numberOfLines={1}>
                      {nameOf(entry)}
                    </Text>
                    {active ? <Dot size={6} /> : null}
                  </View>
                  <Text style={styles.rowSub} numberOfLines={1}>
                    {entry.kind === "hosted"
                      ? t("mobile.selfHost.hostedSub")
                      : t("mobile.selfHost.selfHostedSub", {
                          host: hostOf(entry),
                        })}
                  </Text>
                </View>
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
                  style={({ pressed }) => [
                    { marginLeft: 10 },
                    pressed && styles.rowPressed,
                  ]}
                >
                  <Icon name="trash" size={16} color={colors.textMuted} />
                </Pressable>
              ) : null}
            </View>
          );
        })}
      </View>

      <Hairline space={18} />

      <View testID="server-add">
        <TextAction
          label={t("mobile.selfHost.addServer")}
          icon="plus"
          disabled={busy}
          onPress={() => {
            tapLight();
            router.push("/connect-server");
          }}
        />
      </View>
    </View>
  );
}
