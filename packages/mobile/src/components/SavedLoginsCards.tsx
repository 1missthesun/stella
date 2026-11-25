import { useMemo, useState, type ReactNode } from "react";
import { Alert, Pressable, StyleSheet, View } from "react-native";
import { Text } from "./Text";
import { tapLight } from "../lib/haptics";
import {
  allowSavedValuesJoin,
  askSavedValuesAgain,
  confirmSavedValuesCode,
  declineSavedValuesJoin,
  hideSavedValuesCard,
  startSavedValuesOver,
  useSavedValuesTrust,
  type SavedValuesRequestView,
  type SavedValuesTrustView,
} from "../lib/saved-values-trust";
import { useConversationUserAsks } from "../lib/user-asks";
import { userFacingError } from "../lib/user-facing-error";
import { useT } from "../i18n";
import type { Colors } from "../theme/colors";
import { fonts } from "../theme/fonts";
import { useColors, useTheme } from "../theme/theme-context";
import { settingsSurfaceFills } from "./settings/settings-styles";

type Waiting = Extract<SavedValuesTrustView, { standing: "waiting" }>;

export function useSavedLoginsAction() {
  const [busy, setBusy] = useState(false);
  const run = (action: () => Promise<void>) => {
    if (busy) return;
    tapLight();
    setBusy(true);
    void action()
      .catch((error: unknown) => Alert.alert(userFacingError(error)))
      .finally(() => setBusy(false));
  };
  return { busy, run };
}

export function SavedLoginsChatCards({
  conversationId,
}: {
  conversationId: string | null | undefined;
}) {
  const trust = useSavedValuesTrust();
  const { questions, secureInput } = useConversationUserAsks(conversationId);
  const { run } = useSavedLoginsAction();
  if (questions.length > 0 || secureInput) return null;
  if (trust.standing === "member") {
    const request = trust.requests[0];
    return request ? (
      <SavedLoginsRequestCard key={request.joinId} request={request} />
    ) : null;
  }
  if (trust.standing !== "waiting" || trust.hidden) return null;
  return (
    <SavedLoginsWaitingCard
      waiting={trust}
      onDismiss={() => run(hideSavedValuesCard)}
    />
  );
}

export function SavedLoginsRequestCard({
  request,
}: {
  request: SavedValuesRequestView;
}) {
  const t = useT();
  const { busy, run } = useSavedLoginsAction();
  return (
    <Card
      title={t("mobile.savedLogins.allowTitle", { name: request.name })}
      line={<CodeLine id="allowCheck" code={request.code} />}
    >
      <Action
        label={t("mobile.savedLogins.notNow")}
        disabled={busy}
        onPress={() => run(() => declineSavedValuesJoin(request.joinId))}
      />
      <Action
        primary
        label={t("mobile.savedLogins.allow")}
        disabled={busy}
        onPress={() => run(() => allowSavedValuesJoin(request.joinId))}
      />
    </Card>
  );
}

export function SavedLoginsWaitingCard({
  waiting,
  onDismiss,
}: {
  waiting: Waiting;
  onDismiss?: () => void;
}) {
  const t = useT();
  const { busy, run } = useSavedLoginsAction();
  const name = waiting.answeredBy ?? "";
  const putAway = onDismiss ? (
    <Action
      label={t("mobile.savedLogins.notNow")}
      disabled={busy}
      onPress={onDismiss}
    />
  ) : null;

  if (waiting.stopped) {
    return (
      <Card title={t(`mobile.savedLogins.${waiting.stopped}`)}>
        {putAway}
        <Action
          primary
          label={t("mobile.savedLogins.askAgain")}
          disabled={busy}
          onPress={() => run(askSavedValuesAgain)}
        />
      </Card>
    );
  }

  if (!waiting.code) {
    return (
      <Card
        title={t("mobile.savedLogins.waitingTitle")}
        line={t("mobile.savedLogins.waitingBody", {
          names: waiting.names.join(" / "),
        })}
      >
        <StartOver disabled={busy} run={run} />
        {putAway}
      </Card>
    );
  }

  if (waiting.confirmed) {
    return (
      <Card
        title={t("mobile.savedLogins.confirmed", { name })}
        line={<CodeLine id="compare" name={name} code={waiting.code} />}
      >
        <UseAnother disabled={busy} run={run} />
      </Card>
    );
  }

  return (
    <Card title={<CodeLine id="compare" name={name} code={waiting.code} />}>
      <UseAnother disabled={busy} run={run} />
      <Action
        primary
        label={t("mobile.savedLogins.matches")}
        disabled={busy}
        onPress={() => run(confirmSavedValuesCode)}
      />
    </Card>
  );
}

export function SavedLoginsProblemCard() {
  const t = useT();
  const { busy, run } = useSavedLoginsAction();
  return (
    <Card title={t("mobile.savedLogins.problem")}>
      <StartOver disabled={busy} run={run} />
    </Card>
  );
}

type Run = (action: () => Promise<void>) => void;

function UseAnother({ disabled, run }: { disabled: boolean; run: Run }) {
  const t = useT();
  return (
    <LinkAction
      label={t("mobile.savedLogins.useAnother")}
      disabled={disabled}
      onPress={() => run(askSavedValuesAgain)}
    />
  );
}

function LinkAction({
  label,
  disabled,
  onPress,
}: {
  label: string;
  disabled: boolean;
  onPress: () => void;
}) {
  const styles = useStyles();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      disabled={disabled}
      hitSlop={8}
      onPress={onPress}
      style={({ pressed }) => [styles.linkAction, pressed && styles.pressed]}
    >
      <Text style={styles.link}>{label}</Text>
    </Pressable>
  );
}

const CODE_MARK = "\u2063";

function CodeLine({
  id,
  name = "",
  code,
}: {
  id: "allowCheck" | "compare";
  name?: string;
  code: string;
}) {
  const t = useT();
  const styles = useStyles();
  const [before = "", after = ""] = t(`mobile.savedLogins.${id}`, {
    name,
    code: CODE_MARK,
  }).split(CODE_MARK);
  return (
    <Text
      accessibilityLabel={t(`mobile.savedLogins.${id}`, {
        name,
        code: code.replace(/\D/g, "").split("").join(" "),
      })}
      style={styles.codeLine}
    >
      {before}
      <Text style={styles.code}>{code.replace(" ", "\u00a0")}</Text>
      {after}
    </Text>
  );
}

function StartOver({ disabled, run }: { disabled: boolean; run: Run }) {
  const t = useT();
  return (
    <LinkAction
      label={t("mobile.savedLogins.startOver")}
      disabled={disabled}
      onPress={() => {
        tapLight();
        Alert.alert(
          t("mobile.savedLogins.startOverTitle"),
          t("mobile.savedLogins.startOverBody"),
          [
            { text: t("mobile.common.cancel"), style: "cancel" },
            {
              text: t("mobile.savedLogins.startOver"),
              style: "destructive",
              onPress: () => run(startSavedValuesOver),
            },
          ],
        );
      }}
    />
  );
}

function Card({
  title,
  line,
  children,
}: {
  title: ReactNode;
  line?: ReactNode;
  children?: ReactNode;
}) {
  const styles = useStyles();
  return (
    <View style={styles.card}>
      <View style={styles.copy}>
        {typeof title === "string" ? (
          <Text style={styles.title}>{title}</Text>
        ) : (
          title
        )}
        {typeof line === "string" ? (
          <Text style={styles.body}>{line}</Text>
        ) : (
          line
        )}
      </View>
      {children ? <View style={styles.actions}>{children}</View> : null}
    </View>
  );
}

function Action({
  label,
  onPress,
  disabled,
  primary = false,
}: {
  label: string;
  onPress: () => void;
  disabled: boolean;
  primary?: boolean;
}) {
  const styles = useStyles();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      disabled={disabled}
      hitSlop={6}
      onPress={onPress}
      style={({ pressed }) => [
        primary ? styles.primary : styles.secondary,
        pressed && styles.pressed,
        disabled && styles.disabled,
      ]}
    >
      <Text style={primary ? styles.primaryText : styles.secondaryText}>
        {label}
      </Text>
    </Pressable>
  );
}

const useStyles = () => {
  const colors = useColors();
  const { isDark } = useTheme();
  return useMemo(() => makeStyles(colors, isDark), [colors, isDark]);
};

const makeStyles = (colors: Colors, isDark: boolean) => {
  const { subtleFill, tonalFill } = settingsSurfaceFills(isDark);
  return StyleSheet.create({
    actions: {
      alignItems: "center",
      flexDirection: "row",
      flexWrap: "wrap",
      gap: 8,
      justifyContent: "flex-end",
    },
    body: {
      color: colors.textMuted,
      fontFamily: fonts.sans.regular,
      fontSize: 13.5,
      lineHeight: 19.5,
    },
    card: {
      alignSelf: "stretch",
      backgroundColor: subtleFill,
      borderColor: colors.borderWeak,
      borderRadius: 13,
      borderWidth: StyleSheet.hairlineWidth,
      gap: 12,
      padding: 15,
    },
    code: {
      color: colors.textStrong,
      fontFamily: fonts.sans.semiBold,
      fontSize: 22,
      fontVariant: ["tabular-nums"],
      letterSpacing: 1,
    },
    codeLine: {
      color: colors.textStrong,
      fontFamily: fonts.sans.regular,
      fontSize: 15,
      lineHeight: 30,
    },
    copy: {
      gap: 4,
    },
    disabled: {
      opacity: 0.48,
    },
    link: {
      color: colors.textMuted,
      fontFamily: fonts.sans.medium,
      fontSize: 13.5,
      lineHeight: 19,
    },
    pressed: {
      opacity: 0.65,
    },
    primary: {
      alignItems: "center",
      backgroundColor: colors.accent,
      borderRadius: 9,
      justifyContent: "center",
      minHeight: 34,
      paddingHorizontal: 14,
    },
    primaryText: {
      color: colors.accentForeground,
      fontFamily: fonts.sans.semiBold,
      fontSize: 13.5,
    },
    secondary: {
      alignItems: "center",
      backgroundColor: tonalFill,
      borderRadius: 9,
      justifyContent: "center",
      minHeight: 34,
      paddingHorizontal: 13,
    },
    secondaryText: {
      color: colors.textStrong,
      fontFamily: fonts.sans.medium,
      fontSize: 13.5,
    },
    linkAction: {
      flexGrow: 1,
      flexShrink: 1,
      justifyContent: "center",
      minHeight: 34,
    },
    title: {
      color: colors.textStrong,
      fontFamily: fonts.sans.semiBold,
      fontSize: 15.5,
      letterSpacing: -0.2,
      lineHeight: 21,
    },
  });
};
