import { Alert, Pressable, View } from "react-native";
import { Text } from "../Text";
import type { SavedValuesListedDevice } from "@stella/contracts/saved-values";
import { removeSavedValuesDevice } from "../../lib/saved-values";
import { useSavedValuesTrust } from "../../lib/saved-values-trust";
import { tapLight } from "../../lib/haptics";
import { useLocale, useT } from "../../i18n";
import { useColors } from "../../theme/theme-context";
import { Icon } from "../Icon";
import {
  SavedLoginsProblemCard,
  SavedLoginsRequestCard,
  SavedLoginsWaitingCard,
  useSavedLoginsAction,
} from "../SavedLoginsCards";
import type { SettingsStyles } from "./settings-styles";

export function SavedLoginsSection({ styles }: { styles: SettingsStyles }) {
  const t = useT();
  const trust = useSavedValuesTrust();
  const { busy, run } = useSavedLoginsAction();
  if (trust.standing === "off") return null;

  const confirmRemove = (device: SavedValuesListedDevice) => {
    tapLight();
    Alert.alert(
      t("mobile.savedLogins.removeTitle", { name: device.name }),
      t("mobile.savedLogins.removeBody"),
      [
        { text: t("mobile.common.cancel"), style: "cancel" },
        {
          text: t("mobile.savedLogins.remove"),
          style: "destructive",
          onPress: () => run(() => removeSavedValuesDevice(device.deviceId)),
        },
      ],
    );
  };

  return (
    <View style={styles.section}>
      <Text style={styles.sectionLabel}>{t("mobile.savedLogins.section")}</Text>
      {trust.standing === "waiting" ? (
        <SavedLoginsWaitingCard waiting={trust} />
      ) : null}
      {trust.standing === "problem" ? (
        <SavedLoginsProblemCard />
      ) : null}
      {trust.standing === "member" ? (
        <>
          {trust.requests.map((request) => (
            <SavedLoginsRequestCard key={request.joinId} request={request} />
          ))}
          <View
            style={[
              styles.group,
              trust.requests.length > 0 && styles.groupGap,
            ]}
          >
            {trust.devices.map((device, index) => (
              <DeviceRow
                key={device.deviceId}
                device={device}
                divided={index > 0}
                sameName={trust.devices.some(
                  (other) => other !== device && other.name === device.name,
                )}
                busy={busy}
                onRemove={() => confirmRemove(device)}
                styles={styles}
              />
            ))}
          </View>
        </>
      ) : null}
    </View>
  );
}

function DeviceRow({
  device,
  divided,
  sameName,
  busy,
  onRemove,
  styles,
}: {
  device: SavedValuesListedDevice;
  divided: boolean;
  sameName: boolean;
  busy: boolean;
  onRemove: () => void;
  styles: SettingsStyles;
}) {
  const t = useT();
  const locale = useLocale();
  const colors = useColors();
  const detail = [
    device.thisDevice
      ? t("mobile.savedLogins.thisPhone")
      : device.quiet
        ? t("mobile.savedLogins.quiet")
        : null,
    sameName
      ? t("settings.secureValues.added", {
          added: new Date(device.addedAt).toLocaleString(locale, {
            month: "short",
            day: "numeric",
            hour: "numeric",
            minute: "2-digit",
          }),
        })
      : null,
  ]
    .filter(Boolean)
    .join(" · ");
  return (
    <View style={[styles.row, divided && styles.rowDivider]}>
      <Icon
        name={device.kind === "phone" ? "smartphone" : "monitor"}
        size={18}
        color={colors.textMuted}
        style={styles.rowIcon}
      />
      <View style={styles.rowCopy}>
        <Text numberOfLines={1} style={styles.rowLabel}>
          {device.name}
        </Text>
        {detail ? <Text style={styles.rowSub}>{detail}</Text> : null}
      </View>
      {device.thisDevice ? null : (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t("mobile.savedLogins.removeTitle", {
            name: device.name,
          })}
          disabled={busy}
          hitSlop={8}
          onPress={onRemove}
          style={({ pressed }) => (pressed || busy) && styles.rowPressed}
        >
          <Text style={styles.rowDanger}>{t("mobile.savedLogins.remove")}</Text>
        </Pressable>
      )}
    </View>
  );
}
