import { useEffect, useMemo, useState } from "react";
import { ActivityIndicator, Alert, StyleSheet, View } from "react-native";
import type { AccountProvider } from "@stella/contracts/backend/providers";
import { getBackendClient } from "../../lib/backend";
import { tapLight } from "../../lib/haptics";
import { userFacingError } from "../../lib/user-facing-error";
import type {
  Brain,
  ModelOption,
  ModelSettings,
} from "../../lib/use-cloud-model-settings";
import { useColors } from "../../theme/theme-context";
import { EngineAccountSection } from "../EngineAccountsSettings";
import { Icon } from "../Icon";
import { brainReady } from "./BrainSection";
import { ProviderConnect } from "./ProviderConnect";
import { ProviderMark } from "./ProviderMark";
import {
  ChoiceRow,
  Hairline,
  LineField,
  Note,
  SectionLabel,
  TextAction,
} from "./kit";

/** Above this many, a list gets a search field. */
const SEARCH_FROM = 10;
/** The most rows a list draws at once; search narrows the rest. */
const LIST_CAP = 60;

const authHint = (provider: AccountProvider) => {
  const oauth = provider.authMethods.some((method) => method.kind === "oauth");
  const key = provider.authMethods.some((method) => method.kind === "api_key");
  return oauth && key ? "Sign in or API key" : oauth ? "Sign in" : "API key";
};

function brainDetail(brain: Brain, settings: ModelSettings): string {
  if (brain.kind === "engine") {
    if (brain.engine === "stella") return "Included";
    return settings.connectedProviders?.includes(brain.engine)
      ? "Signed in"
      : "Sign in";
  }
  const connection = brain.provider.connection;
  if (!connection) return authHint(brain.provider);
  if (connection.status === "invalid") return "Key not accepted";
  if (connection.status === "reauth_required") return "Sign in again";
  return connection.label;
}

const contextLabel = (tokens: number) =>
  tokens >= 1_000_000
    ? `${Number((tokens / 1_000_000).toFixed(1))}M`
    : `${Math.round(tokens / 1000)}K`;

const matches = (query: string, ...values: string[]) => {
  const needle = query.trim().toLowerCase();
  return (
    !needle || values.some((value) => value.toLowerCase().includes(needle))
  );
};

/**
 * Every provider the chat can run on, the ones ready to use first. A row
 * opens that provider's page, where it connects and its models are picked.
 */
export function ProvidersPage({
  settings,
  onOpenBrain,
}: {
  settings: ModelSettings;
  onOpenBrain: (brainId: string) => void;
}) {
  const colors = useColors();
  const [query, setQuery] = useState("");
  const brains = settings.brains.filter((brain) =>
    matches(
      query,
      brain.label,
      brain.kind === "provider" ? brain.provider.id : brain.engine,
    ),
  );
  const ready = brains.filter((brain) => brainReady(brain, settings));
  const more = brains.filter((brain) => !ready.includes(brain));

  const row = (brain: Brain) => {
    const warn =
      brain.kind === "provider" &&
      brain.provider.connection !== null &&
      brain.provider.connection.status !== "ok";
    return (
      <ChoiceRow
        key={brain.id}
        label={brain.label}
        detail={brainDetail(brain, settings)}
        selected={brain.id === settings.brainId}
        leading={<ProviderMark provider={brain.mark} size={22} />}
        trailing={
          warn ? (
            <Icon name="alert-circle" size={16} color={colors.warning} />
          ) : (
            <Icon name="chevron-right" size={14} color={colors.textWeaker} />
          )
        }
        onPress={() => {
          tapLight();
          onOpenBrain(brain.id);
        }}
      />
    );
  };

  return (
    <View>
      {settings.brains.length > SEARCH_FROM ? (
        <View style={pageStyles.search}>
          <LineField
            value={query}
            onChangeText={setQuery}
            placeholder="Search providers"
            autoCapitalize="none"
            autoCorrect={false}
            clearButtonMode="while-editing"
            returnKeyType="search"
            trailing={
              <Icon name="search" size={16} color={colors.textWeaker} />
            }
          />
        </View>
      ) : null}
      {settings.providers === undefined ? (
        <ActivityIndicator size="small" color={colors.textMuted} />
      ) : null}
      {ready.length > 0 ? (
        <View>
          <SectionLabel>Ready</SectionLabel>
          {ready.map(row)}
        </View>
      ) : null}
      {ready.length > 0 && more.length > 0 ? <Hairline /> : null}
      {more.length > 0 ? (
        <View>
          <SectionLabel>Add a provider</SectionLabel>
          {more.map(row)}
        </View>
      ) : null}
      {brains.length === 0 ? <Note>No provider matches “{query}”.</Note> : null}
    </View>
  );
}

/**
 * One provider: how it's connected (or the way to connect it), then its
 * models, where a pick makes it the chat's brain.
 */
export function BrainPage({
  settings,
  brainId,
}: {
  settings: ModelSettings;
  brainId: string;
}) {
  const brain = settings.brains.find((entry) => entry.id === brainId);
  if (!brain) return <Note>This provider isn't available.</Note>;

  if (brain.kind === "engine") {
    return (
      <View>
        {brain.engine === "stella" ? (
          <Note>Included with your Stella plan.</Note>
        ) : (
          <EngineAccountSection provider={brain.engine} embedded="panel" />
        )}
        <Hairline />
        <ModelList
          options={settings.modelsFor(brain.id)}
          onPick={(model) => settings.selectEngineModel(brain.engine, model)}
        />
      </View>
    );
  }
  return (
    <AccountProviderPage
      settings={settings}
      provider={brain.provider}
      brainId={brain.id}
    />
  );
}

function AccountProviderPage({
  settings,
  provider,
  brainId,
}: {
  settings: ModelSettings;
  provider: AccountProvider;
  brainId: string;
}) {
  const colors = useColors();
  const connection = provider.connection;
  const connected = connection?.status === "ok";
  const [replacing, setReplacing] = useState(false);
  const [removing, setRemoving] = useState(false);
  const { loadProviderModels, refresh } = settings;
  const state = settings.providerModelState(provider.id);

  useEffect(() => {
    if (connected) void loadProviderModels(provider.id);
  }, [connected, provider.id, loadProviderModels]);

  const onConnected = () => {
    setReplacing(false);
    void refresh().then(() => loadProviderModels(provider.id, true));
  };

  const remove = () => {
    Alert.alert(
      `Remove ${provider.label}?`,
      settings.brainId === brainId
        ? "Its key is deleted from your account and this chat goes back to Stella."
        : "Its key is deleted from your account.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Remove",
          style: "destructive",
          onPress: () => {
            setRemoving(true);
            void getBackendClient()
              .call("providers.remove", { provider: provider.id })
              .then(() => refresh())
              .catch((error: unknown) =>
                Alert.alert(
                  `Couldn't remove ${provider.label}`,
                  userFacingError(error),
                ),
              )
              .finally(() => setRemoving(false));
          },
        },
      ],
    );
  };

  return (
    <View>
      {connection ? (
        <View style={pageStyles.status}>
          <View
            style={[
              pageStyles.statusDot,
              { backgroundColor: connected ? colors.ok : colors.warning },
            ]}
          />
          <Note>
            {connected
              ? connection.label
              : connection.status === "invalid"
                ? `${provider.label} no longer accepts this key.`
                : "This sign-in ended. Connect again."}
          </Note>
        </View>
      ) : null}

      {!connected || replacing ? (
        <View style={pageStyles.connect}>
          <ProviderConnect provider={provider} onConnected={onConnected} />
          {replacing ? (
            <TextAction
              label="Keep the current one"
              tone="muted"
              onPress={() => setReplacing(false)}
            />
          ) : null}
        </View>
      ) : (
        <View style={pageStyles.manage}>
          <TextAction
            label={
              connection?.method === "oauth" ? "Sign in again" : "Replace key"
            }
            onPress={() => setReplacing(true)}
          />
          <TextAction
            label={removing ? "Removing…" : "Remove"}
            tone="danger"
            disabled={removing}
            onPress={remove}
          />
        </View>
      )}

      {connected ? (
        <>
          <Hairline />
          {state?.status === "error" ? (
            <View style={pageStyles.connect}>
              <Note>Couldn't load {provider.label}'s models.</Note>
              <TextAction
                label="Try again"
                onPress={() => void loadProviderModels(provider.id, true)}
              />
            </View>
          ) : state?.status !== "ready" ? (
            <ActivityIndicator size="small" color={colors.textMuted} />
          ) : (
            <ModelList
              options={settings.modelsFor(brainId)}
              details={Object.fromEntries(
                state.models.map((model) => [
                  model.id,
                  model.contextWindow
                    ? `${contextLabel(model.contextWindow)} context`
                    : "",
                ]),
              )}
              onPick={(model) =>
                settings.selectProviderModel(provider.id, model)
              }
            />
          )}
        </>
      ) : null}
    </View>
  );
}

function ModelList({
  options,
  details,
  onPick,
}: {
  options: ModelOption[];
  details?: Record<string, string>;
  onPick: (model: string) => void;
}) {
  const colors = useColors();
  const [query, setQuery] = useState("");
  const shown = useMemo(() => {
    const hits = options.filter((option) =>
      matches(query, option.label, option.id),
    );
    const capped = hits.slice(0, LIST_CAP);
    const chosen = hits.find((option) => option.selected);
    if (chosen && !capped.includes(chosen)) capped.unshift(chosen);
    return { rows: capped, hidden: hits.length - capped.length };
  }, [options, query]);

  return (
    <View accessibilityRole="radiogroup">
      <SectionLabel>Models</SectionLabel>
      {options.length > SEARCH_FROM ? (
        <View style={pageStyles.search}>
          <LineField
            value={query}
            onChangeText={setQuery}
            placeholder={`Search ${options.length} models`}
            autoCapitalize="none"
            autoCorrect={false}
            clearButtonMode="while-editing"
            returnKeyType="search"
            trailing={
              <Icon name="search" size={16} color={colors.textWeaker} />
            }
          />
        </View>
      ) : null}
      {options.length === 0 ? <Note>No models available.</Note> : null}
      {shown.rows.map((option) => (
        <ChoiceRow
          key={option.id}
          label={option.label}
          detail={details?.[option.id] || undefined}
          selected={option.selected}
          disabled={!option.available}
          onPress={() => {
            if (option.selected) return;
            tapLight();
            onPick(option.id);
          }}
        />
      ))}
      {shown.hidden > 0 ? (
        <Note>{shown.hidden} more. Search to find them.</Note>
      ) : null}
    </View>
  );
}

const pageStyles = StyleSheet.create({
  search: {
    marginBottom: 14,
  },
  status: {
    alignItems: "center",
    flexDirection: "row",
    gap: 8,
    marginBottom: 14,
  },
  statusDot: {
    borderRadius: 3,
    height: 6,
    width: 6,
  },
  connect: {
    gap: 12,
  },
  manage: {
    flexDirection: "row",
    gap: 24,
  },
});
