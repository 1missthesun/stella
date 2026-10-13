import { useEffect } from "react";
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import type {
  EngineConnection,
  EngineProvider,
} from "@stella/contracts/backend/engines";
import { isEngineConnectionUsable } from "@stella/contracts/backend/engines";
import { useBackendView } from "../../lib/backend";
import { tapLight } from "../../lib/haptics";
import { CONTENT_MAX_FONT_SCALE } from "../../lib/setup-text-defaults";
import { useT } from "../../i18n";
import { REASONING_OPTIONS } from "../../lib/stella-model-catalog";
import type { Brain, ModelSettings } from "../../lib/use-cloud-model-settings";
import type { Colors } from "../../theme/colors";
import { fonts } from "../../theme/fonts";
import { useColors } from "../../theme/theme-context";
import { NativeMenu } from "../NativeMenu";
import type { NativeMenuItem } from "../NativeMenu.types";
import { accountInitials } from "../EngineAccountsSettings";
import { Icon } from "../Icon";
import { ProviderMark } from "./ProviderMark";
import {
  ChoiceRow,
  Dot,
  KIT,
  Note,
  SectionLabel,
  SwitcherFace,
  TextAction,
} from "./kit";

/** Models shown under the switcher before "All models" takes over. */
const SHORT_LIST = 5;

/**
 * Whether a brain can run now without setting anything up: Stella always;
 * Claude Code and ChatGPT once an account is signed in for the cloud; an
 * account provider once its key or sign-in works. The one in use counts too.
 * The Providers page sorts by this.
 */
export const brainReady = (brain: Brain, settings: ModelSettings) => {
  if (brain.id === settings.brainId) return true;
  if (brain.kind === "provider")
    return brain.provider.connection?.status === "ok";
  if (brain.engine === "stella") return true;
  return settings.connectedProviders?.includes(brain.engine) ?? false;
};

/**
 * Which brain runs the chat, shown as the one in use with its models under
 * it. The switcher's system menu always holds the same four entries: Stella,
 * Claude Code, ChatGPT, and Other, which opens the page of every provider, so
 * the page stays this size however many providers there are.
 */
export function BrainSection({
  settings,
  active,
  width,
  onOpenProviders,
  onOpenBrain,
}: {
  settings: ModelSettings;
  active: boolean;
  width: number;
  onOpenProviders: () => void;
  onOpenBrain: (brainId: string) => void;
}) {
  const colors = useColors();
  const styles = makeStyles(colors);
  const { refresh } = settings;

  useEffect(() => {
    if (active) void refresh();
  }, [active, refresh]);

  const ready = settings.execution !== null;
  const current =
    settings.brains.find((brain) => brain.id === settings.brainId) ??
    settings.brains[0];
  const models = settings.modelsFor(settings.brainId);
  const chosen = models.find((model) => model.selected);
  const shown = models.slice(0, SHORT_LIST);
  if (chosen && !shown.includes(chosen)) shown[shown.length - 1] = chosen;
  const loadingModels =
    current?.kind === "provider" &&
    settings.providerModelState(current.provider.id)?.status === "loading";
  const moreLabel =
    models.length > SHORT_LIST
      ? `All ${models.length} models`
      : current?.kind === "provider"
        ? "Manage"
        : null;
  const switchTo = (brain: Brain) => {
    if (brain.id === settings.brainId) return;
    tapLight();
    if (brain.kind === "engine") {
      settings.selectEngine(brain.engine);
      return;
    }
    void settings.loadProviderModels(brain.provider.id).then((list) => {
      const first = list?.[0];
      if (first) settings.selectProviderModel(brain.provider.id, first.id);
      else onOpenBrain(brain.id);
    });
  };

  const items: NativeMenuItem[] = [
    ...settings.brains
      .filter((brain) => brain.kind === "engine")
      .map((brain): NativeMenuItem => ({
        id: brain.id,
        title: brain.label,
        selected: brain.id === settings.brainId,
        onPress: () => switchTo(brain),
      })),
    {
      id: "other",
      title: "Other",
      selected: current?.kind === "provider",
      onPress: onOpenProviders,
    },
  ];

  return (
    <View>
      <SectionLabel
        trailing={
          !ready ? (
            <ActivityIndicator size="small" color={colors.textMuted} />
          ) : null
        }
      >
        Model
      </SectionLabel>

      <NativeMenu
        plain
        label={
          <SwitcherFace
            glyph={
              <ProviderMark provider={current?.mark ?? "stella"} size={26} />
            }
            title={current?.label ?? "Stella"}
          />
        }
        accessibilityLabel={`Model provider: ${current?.label ?? "Stella"}`}
        items={items}
        width={width}
        height={KIT.switcherHeight}
        disabled={!ready}
        onFallbackPress={onOpenProviders}
      />

      <View style={styles.models} accessibilityRole="radiogroup">
        {loadingModels ? (
          <ActivityIndicator
            style={styles.spinner}
            size="small"
            color={colors.textMuted}
          />
        ) : models.length === 0 ? (
          <Note>No models available.</Note>
        ) : (
          shown.map((model) => (
            <ChoiceRow
              key={model.id}
              label={model.label}
              selected={model.selected}
              disabled={!model.available}
              accessibilityLabel={
                model.description
                  ? `${model.label}, ${model.description}`
                  : model.label
              }
              onPress={() => {
                if (model.selected) return;
                tapLight();
                settings.selectModel(model.id);
              }}
            />
          ))
        )}
        {current && moreLabel ? (
          <TextAction
            label={moreLabel}
            onPress={() => onOpenBrain(current.id)}
          />
        ) : null}
      </View>
    </View>
  );
}

/**
 * The engine whose accounts the chat's brain runs on: Claude Code or
 * ChatGPT. Stella and account providers have none to pick between.
 */
export const accountsEngine = (
  settings: ModelSettings,
): EngineProvider | null => {
  const current = settings.brains.find(
    (brain) => brain.id === settings.brainId,
  );
  return current?.kind === "engine" && current.engine !== "stella"
    ? current.engine
    : null;
};

/**
 * The account the engine runs on, as one row at the sidebar's foot. Tapping
 * it opens the accounts page, where they are added, chosen and managed.
 */
export function EngineAccountRow({
  provider,
  onPress,
}: {
  provider: EngineProvider;
  onPress: () => void;
}) {
  const colors = useColors();
  const styles = makeStyles(colors);
  const t = useT();
  const { value: engines } = useBackendView("engines.get", {});
  const accounts = (engines?.connections ?? []).filter(
    (row) => row.provider === provider,
  );
  let row: EngineConnection | undefined;
  let label: string;
  let detail: string | undefined;
  let warn = false;
  if (provider === "anthropic") {
    const chosenId = engines?.claude?.chosenAccountId ?? null;
    row = accounts.find((entry) => entry.accountId === chosenId);
    if (row) {
      label = row.email ?? row.label;
      detail = row.plan
        ? `${row.plan.charAt(0).toUpperCase()}${row.plan.slice(1)}`
        : undefined;
    } else if (accounts.length > 0 || engines?.claude) {
      label = t("mobile.engineAccounts.claudeDefault");
    } else {
      label = t("mobile.engineAccounts.connectClaude");
    }
  } else {
    row = accounts.find((entry) => entry.active);
    if (row) {
      label = row.email ?? row.name ?? row.label;
      warn = !isEngineConnectionUsable(row);
      detail =
        row.status === "signed_out"
          ? t("mobile.engineAccounts.statusSignedOut")
          : row.status === "reauth_required"
            ? t("mobile.engineAccounts.statusReauth")
            : row.planUsage === false
              ? t("mobile.engineAccounts.statusPlanUsageOff")
              : row.plan;
    } else {
      label = t("settings.engineAccounts.addChatgpt");
    }
  }
  if (!engines) label = "";

  return (
    <View>
      <SectionLabel>Account</SectionLabel>
      <Pressable
        onPress={() => {
          tapLight();
          onPress();
        }}
        accessibilityRole="button"
        accessibilityLabel={`Account: ${label}`}
        accessibilityHint="Opens the accounts"
        style={({ pressed }) => [styles.account, pressed && styles.pressed]}
      >
        <View style={styles.avatar}>
          {row ? (
            <Text
              style={styles.avatarText}
              maxFontSizeMultiplier={1}
              numberOfLines={1}
            >
              {accountInitials(row)}
            </Text>
          ) : (
            <ProviderMark provider={provider} size={20} />
          )}
        </View>
        <View style={styles.accountText}>
          <Text
            style={styles.accountLabel}
            numberOfLines={1}
            ellipsizeMode="middle"
            maxFontSizeMultiplier={CONTENT_MAX_FONT_SCALE}
          >
            {label}
          </Text>
          {detail ? (
            <Text
              style={[styles.accountDetail, warn && styles.accountWarn]}
              numberOfLines={1}
              maxFontSizeMultiplier={CONTENT_MAX_FONT_SCALE}
            >
              {detail}
            </Text>
          ) : null}
        </View>
        {!engines ? (
          <ActivityIndicator size="small" color={colors.textMuted} />
        ) : warn ? (
          <Icon name="alert-circle" size={16} color={colors.warning} />
        ) : (
          <Icon name="chevron-right" size={14} color={colors.textWeaker} />
        )}
      </Pressable>
    </View>
  );
}

/**
 * How hard the chosen model thinks: once, right under the model list.
 */
export function ThinkingRow({ settings }: { settings: ModelSettings }) {
  const colors = useColors();
  const styles = makeStyles(colors);
  const effort = settings.effort;
  return (
    <View>
      <SectionLabel>Thinking</SectionLabel>
      <View style={styles.efforts} accessibilityRole="radiogroup">
        {REASONING_OPTIONS.map((option) => {
          const picked = option.id === effort;
          return (
            <Pressable
              key={option.id}
              onPress={() => {
                if (picked) return;
                tapLight();
                settings.selectEffort(option.id);
              }}
              hitSlop={{ top: 8, bottom: 8 }}
              accessibilityRole="radio"
              accessibilityLabel={`Thinking ${option.label}`}
              accessibilityState={{ checked: picked }}
              style={({ pressed }) => [
                styles.effort,
                pressed && !picked && styles.pressed,
              ]}
            >
              <Text
                style={[styles.effortLabel, picked && styles.effortPicked]}
                numberOfLines={1}
                maxFontSizeMultiplier={1.3}
              >
                {option.label}
              </Text>
              <View style={styles.effortMark}>
                {picked ? <Dot size={6} /> : null}
              </View>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

const makeStyles = (colors: Colors) =>
  StyleSheet.create({
    models: {
      marginLeft: 42,
      marginTop: 2,
    },
    spinner: {
      alignSelf: "flex-start",
      marginVertical: 12,
    },
    account: {
      alignItems: "center",
      flexDirection: "row",
      gap: 12,
      minHeight: 56,
      paddingVertical: 6,
    },
    avatar: {
      alignItems: "center",
      backgroundColor: colors.surfaceInset,
      borderRadius: 16,
      height: 32,
      justifyContent: "center",
      width: 32,
    },
    avatarText: {
      color: colors.text,
      fontFamily: fonts.sans.bold,
      fontSize: 13,
      letterSpacing: -0.2,
    },
    accountText: {
      flex: 1,
      minWidth: 0,
    },
    accountLabel: {
      color: colors.text,
      fontFamily: fonts.sans.semiBold,
      fontSize: 17,
      letterSpacing: -0.3,
    },
    accountDetail: {
      color: colors.textMuted,
      fontFamily: fonts.sans.medium,
      fontSize: 13,
      marginTop: 1,
    },
    accountWarn: {
      color: colors.warning,
    },
    efforts: {
      flexDirection: "row",
      justifyContent: "space-between",
      paddingRight: 6,
    },
    effort: {
      alignItems: "center",
      gap: 4,
      justifyContent: "center",
      minHeight: 40,
      minWidth: 34,
    },
    effortLabel: {
      color: colors.textMuted,
      fontFamily: fonts.sans.semiBold,
      fontSize: 16,
      letterSpacing: -0.3,
    },
    effortPicked: {
      color: colors.text,
    },
    effortMark: {
      height: 6,
      width: 6,
    },
    pressed: {
      opacity: 0.55,
    },
  });
