import { useEffect, useMemo, useState } from "react";
import type { AccountProvider } from "@stella/contracts/backend/providers";
import { backendClient } from "@/platform/backend/backend-client";
import { Icon } from "../../../../desktop-rune/ui/kit";
import { phoneAlert, phoneSheet } from "../ask";
import { glyph } from "../icons";
import { ChoiceRow, Hairline, SectionLabel, TextAction, useRn } from "../rn";
import { brainReady } from "./BrainSection";
import { EngineAccountSection } from "./EngineAccounts";
import { Dimmed, errorText, LineField, Note, Spinner, tapLight } from "./kit";
import { ProviderConnect } from "./ProviderConnect";
import { ProviderMark } from "./ProviderMark";
import type { Brain, ModelOption, ModelSettings } from "./use-model-settings";

// packages/mobile's chat-settings/ProviderPages: every brain (Ready, then Add a provider), and one
// brain's page: its sign-in or key, then its models.

const SEARCH_FROM = 10;
const LIST_CAP = 60;

const authHint = (provider: AccountProvider) => {
  const oauth = provider.authMethods.some((method) => method.kind === "oauth");
  const key = provider.authMethods.some((method) => method.kind === "api_key");
  return oauth && key ? "Sign in or API key" : oauth ? "Sign in" : "API key";
};

function brainDetail(brain: Brain, settings: ModelSettings): string {
  if (brain.kind === "engine") {
    if (brain.engine === "stella") return "Included";
    if (settings.connectedProviders?.includes(brain.engine)) return "Signed in";
    return brain.id === settings.brainId ? "In use · Sign in for Cloud" : "Sign in";
  }
  if (brain.kind === "computer") {
    const computers = settings.computerSignIns[brain.provider] ?? [];
    if (computers.length > 0) return `On ${computers.join(", ")}`;
    return brain.id === settings.brainId ? "In use · Sign in on a computer" : "Sign in on a computer";
  }
  const connection = brain.provider.connection;
  if (!connection) return authHint(brain.provider);
  if (connection.status === "invalid") return "Key not accepted";
  if (connection.status === "reauth_required") return "Sign in again";
  return connection.label;
}

const contextLabel = (tokens: number) => (tokens >= 1_000_000 ? `${Number((tokens / 1_000_000).toFixed(1))}M` : `${Math.round(tokens / 1000)}K`);

const matches = (query: string, ...values: string[]) => {
  const needle = query.trim().toLowerCase();
  return !needle || values.some((value) => value.toLowerCase().includes(needle));
};

function SearchField({ id, value, onChange, placeholder }: { id: string; value: string; onChange: (next: string) => void; placeholder: string }) {
  const c = useRn();
  return (
    <box w="full" mb={14}>
      <LineField id={id} value={value} onChange={onChange} placeholder={placeholder} trailing={<Icon icon={glyph("search")} size={16} color={c.textWeaker} />} />
    </box>
  );
}

export function ProvidersPage({ settings, onOpenBrain }: { settings: ModelSettings; onOpenBrain: (brainId: string) => void }) {
  const c = useRn();
  const [query, setQuery] = useState("");
  const brains = settings.brains.filter((brain) =>
    matches(query, brain.label, brain.kind === "engine" ? brain.engine : brain.kind === "computer" ? brain.provider : brain.provider.id, ...(brain.kind === "computer" ? ["gemini", "google"] : [])),
  );
  const ready = brains.filter((brain) => brainReady(brain, settings));
  const more = brains.filter((brain) => !ready.includes(brain));

  const row = (brain: Brain) => {
    const warn = brain.kind === "provider" && brain.provider.connection !== null && brain.provider.connection.status !== "ok";
    return (
      <ChoiceRow
        key={brain.id}
        id={`phone-chat-settings-brain-${brain.id}`}
        label={brain.label}
        detail={brainDetail(brain, settings)}
        selected={brain.id === settings.brainId}
        leading={<ProviderMark provider={brain.mark} size={22} />}
        trailing={warn ? <Icon icon={glyph("alert-circle")} size={16} color={c.warning} /> : <Icon icon={glyph("chevron-right")} size={14} color={c.textWeaker} />}
        onPress={() => {
          tapLight();
          onOpenBrain(brain.id);
        }}
      />
    );
  };

  return (
    <col w="full">
      {settings.brains.length > SEARCH_FROM ? <SearchField id="phone-chat-settings-provider-search" value={query} onChange={setQuery} placeholder="Search providers" /> : null}
      {settings.providers === undefined ? <Spinner color={c.textMuted} /> : null}
      {ready.length > 0 ? (
        <col w="full">
          <SectionLabel>Ready</SectionLabel>
          {ready.map(row)}
        </col>
      ) : null}
      {ready.length > 0 && more.length > 0 ? <Hairline /> : null}
      {more.length > 0 ? (
        <col w="full">
          <SectionLabel>Add a provider</SectionLabel>
          {more.map(row)}
        </col>
      ) : null}
      {brains.length === 0 ? <Note>No provider matches “{query}”.</Note> : null}
    </col>
  );
}

export function BrainPage({ settings, brainId }: { settings: ModelSettings; brainId: string }) {
  const brain = settings.brains.find((entry) => entry.id === brainId);
  if (!brain) return <Note>This provider isn't available.</Note>;

  if (brain.kind === "engine") {
    return (
      <col w="full">
        {brain.engine === "stella" ? <Note>Included with your Stella plan.</Note> : <EngineAccountSection provider={brain.engine} inUse={settings.engine === brain.engine} />}
        <Hairline />
        <ModelList options={settings.modelsFor(brain.id)} onPick={(model) => settings.selectEngineModel(brain.engine, model)} />
      </col>
    );
  }
  if (brain.kind === "computer") {
    const computers = settings.computerSignIns[brain.provider] ?? [];
    const options = settings.modelsFor(brain.id);
    return (
      <col w="full">
        <Note>
          {computers.length > 0
            ? `Runs on ${computers.join(", ")}, on the Google plan signed in there. Your phone's chats use it when they run on that computer.`
            : "Runs only on a computer signed in to Google Antigravity. Sign in on your computer in Settings › Claude and ChatGPT, then chats that run there use it."}
        </Note>
        <Hairline />
        <ModelList options={options} details={Object.fromEntries(options.map((model) => [model.id, model.description ?? ""]))} onPick={(model) => settings.selectProviderModel(brain.provider, model)} />
      </col>
    );
  }
  return <AccountProviderPage settings={settings} provider={brain.provider} brainId={brain.id} />;
}

function AccountProviderPage({ settings, provider, brainId }: { settings: ModelSettings; provider: AccountProvider; brainId: string }) {
  const c = useRn();
  const connection = provider.connection;
  const connected = connection?.status === "ok";
  const [replacing, setReplacing] = useState(false);
  const [removing, setRemoving] = useState(false);
  const { loadProviderModels } = settings;
  const state = settings.providerModelState(provider.id);

  useEffect(() => {
    if (connected) void loadProviderModels(provider.id);
  }, [connected, provider.id, loadProviderModels]);

  const onConnected = () => {
    setReplacing(false);
    void loadProviderModels(provider.id, true);
  };

  const remove = async () => {
    const picked = await phoneSheet({
      title: `Remove ${provider.label}?`,
      message: settings.brainId === brainId ? "Its key is deleted from your account and this chat goes back to Stella." : "Its key is deleted from your account.",
      actions: [{ id: "remove", label: "Remove" }],
      destructive: "remove",
      cancel: "Cancel",
      alert: true,
    });
    if (picked !== "remove") return;
    setRemoving(true);
    try {
      await backendClient.call("providers.remove", { provider: provider.id });
    } catch (error) {
      void phoneAlert(`Couldn't remove ${provider.label}`, errorText(error), "OK");
    } finally {
      setRemoving(false);
    }
  };

  return (
    <col w="full">
      {connection ? (
        <row align="center" gap={8} mb={14}>
          <box w={6} h={6} radius={3} fill={connected ? c.ok : c.warning} shrink={false} />
          <Note>{connected ? connection.label : connection.status === "invalid" ? `${provider.label} no longer accepts this key.` : "This sign-in ended. Connect again."}</Note>
        </row>
      ) : null}

      {!connected || replacing ? (
        <col w="full" gap={12}>
          <ProviderConnect provider={provider} onConnected={onConnected} />
          {replacing ? <TextAction label="Keep the current one" tone="muted" onPress={() => setReplacing(false)} /> : null}
        </col>
      ) : (
        <row gap={24}>
          <TextAction label={connection?.method === "oauth" ? "Sign in again" : "Replace key"} onPress={() => setReplacing(true)} />
          <Dimmed off={removing}>
            <TextAction label={removing ? "Removing…" : "Remove"} tone="danger" onPress={() => void remove()} />
          </Dimmed>
        </row>
      )}

      {connected ? (
        <>
          <Hairline />
          {state?.status === "error" ? (
            <col w="full" gap={12}>
              <Note>Couldn't load {provider.label}'s models.</Note>
              <TextAction label="Try again" onPress={() => void loadProviderModels(provider.id, true)} />
            </col>
          ) : state?.status !== "ready" ? (
            <Spinner color={c.textMuted} />
          ) : (
            <ModelList
              options={settings.modelsFor(brainId)}
              details={Object.fromEntries(state.models.map((model) => [model.id, model.contextWindow ? `${contextLabel(model.contextWindow)} context` : ""]))}
              onPick={(model) => settings.selectProviderModel(provider.id, model)}
            />
          )}
        </>
      ) : null}
    </col>
  );
}

function ModelList({ options, details, onPick }: { options: ModelOption[]; details?: Record<string, string>; onPick: (model: string) => void }) {
  const [query, setQuery] = useState("");
  const shown = useMemo(() => {
    const hits = options.filter((option) => matches(query, option.label, option.id));
    const capped = hits.slice(0, LIST_CAP);
    const chosen = hits.find((option) => option.selected);
    if (chosen && !capped.includes(chosen)) capped.unshift(chosen);
    return { rows: capped, hidden: hits.length - capped.length };
  }, [options, query]);

  return (
    <col w="full" role="radiogroup">
      <SectionLabel>Models</SectionLabel>
      {options.length > SEARCH_FROM ? <SearchField id="phone-chat-settings-model-search" value={query} onChange={setQuery} placeholder={`Search ${options.length} models`} /> : null}
      {options.length === 0 ? <Note>No models available.</Note> : null}
      {shown.rows.map((option) => (
        <ChoiceRow
          key={option.id}
          id={`phone-chat-settings-model-option-${option.id}`}
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
      {shown.hidden > 0 ? <Note>{shown.hidden} more. Search to find them.</Note> : null}
    </col>
  );
}
