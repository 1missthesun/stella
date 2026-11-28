import { useCallback, useEffect, useRef, useState } from "react";
import type { AccountProvider, ProviderAuthMethod, ProviderOAuthFlow } from "@stella/contracts/backend/providers";
import { backendClient } from "@/platform/backend/backend-client";
import { openExternalUrl } from "@/platform/electron/open-external";
import { engine } from "../../../../desktop-rune/ui/kit/engine";
import { phoneAlert } from "../ask";
import { glyph } from "../icons";
import { rt, TextAction, useRn } from "../rn";
import { errorText, LineField, Note, notifyError, notifySuccess, PrimaryButton, tapLight } from "./kit";

// packages/mobile's chat-settings/ProviderConnect: a provider's sign-in (a device code to enter,
// or a page whose code is pasted back) and its API key form.

type OAuthMethod = Extract<ProviderAuthMethod, { kind: "oauth" }>;
type KeyMethod = Extract<ProviderAuthMethod, { kind: "api_key" }>;

const errorReason = (error: unknown) => (error && typeof error === "object" && "reason" in error ? (error as { reason?: unknown }).reason : undefined);

const hostOf = (url: string) => {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
};

const readClipboard = async () => (await navigator.clipboard.readText().catch(() => "")).trim();

const CODE_TEXT = rt(32, 500, 3, undefined, "mono");

export function ProviderConnect({ provider, onConnected }: { provider: AccountProvider; onConnected: () => void }) {
  const oauth = provider.authMethods.find((method): method is OAuthMethod => method.kind === "oauth");
  const keyMethod = provider.authMethods.find((method): method is KeyMethod => method.kind === "api_key");
  const [flow, setFlow] = useState<ProviderOAuthFlow | null>(null);
  const [starting, setStarting] = useState(false);
  const signingIn = flow?.status === "pending";
  return (
    <col w="full" gap={26}>
      {oauth ? <SignIn provider={provider} method={oauth} flow={flow} setFlow={setFlow} starting={starting} setStarting={setStarting} onConnected={onConnected} /> : null}
      {keyMethod && !signingIn ? <ApiKeyForm provider={provider} method={keyMethod} secondary={Boolean(oauth)} onConnected={onConnected} /> : null}
    </col>
  );
}

function ApiKeyForm({ provider, method, secondary, onConnected }: { provider: AccountProvider; method: KeyMethod; secondary: boolean; onConnected: () => void }) {
  const [key, setKey] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const save = async () => {
    const apiKey = key.trim();
    if (!apiKey || saving) return;
    setSaving(true);
    setError(null);
    try {
      await backendClient.call("providers.setApiKey", { provider: provider.id, apiKey });
      setKey("");
      notifySuccess();
      onConnected();
    } catch (cause) {
      notifyError();
      setError(errorReason(cause) === "invalid_api_key" ? `${provider.label} didn't accept that key. Check it and try again.` : errorText(cause));
    } finally {
      setSaving(false);
    }
  };

  const paste = async () => {
    const clip = await readClipboard();
    if (clip) {
      setKey(clip);
      setError(null);
    }
  };

  return (
    <col w="full" gap={14}>
      {secondary ? <Note>Or use an API key</Note> : null}
      <LineField
        id={`phone-provider-key-${provider.id}`}
        value={key}
        onChange={(text) => {
          setKey(text);
          setError(null);
        }}
        placeholder={/[a-z0-9]/i.test(method.placeholder) ? method.placeholder : "API key"}
        label={`${provider.label} API key`}
        secure
        onSubmit={() => void save()}
        trailing={key ? null : <TextAction label="Paste" onPress={() => void paste()} />}
      />
      {error ? <Note tone="danger">{error}</Note> : null}
      <PrimaryButton id={`phone-provider-save-${provider.id}`} label="Save key" busy={saving} disabled={!key.trim()} onPress={() => void save()} />
      {method.keyUrl ? <TextAction label="Get a key" icon={glyph("arrow-up-right")} tone="muted" onPress={() => openExternalUrl(method.keyUrl as string)} /> : null}
    </col>
  );
}

function SignIn({
  provider,
  method,
  flow,
  setFlow,
  starting,
  setStarting,
  onConnected,
}: {
  provider: AccountProvider;
  method: OAuthMethod;
  flow: ProviderOAuthFlow | null;
  setFlow: (flow: ProviderOAuthFlow | null) => void;
  starting: boolean;
  setStarting: (value: boolean) => void;
  onConnected: () => void;
}) {
  const c = useRn();
  const [pasted, setPasted] = useState("");
  const [finishing, setFinishing] = useState(false);
  const flowRef = useRef(flow);
  flowRef.current = flow;
  const mounted = useRef(true);
  useEffect(
    () => () => {
      mounted.current = false;
      const open = flowRef.current;
      if (open?.status === "pending") void backendClient.call("providers.cancelOAuth", { flowId: open.flowId }).catch(() => {});
    },
    [],
  );

  const settle = useCallback(
    (next: ProviderOAuthFlow) => {
      if (!mounted.current) return;
      if (next.status === "complete") {
        setFlow(null);
        setPasted("");
        notifySuccess();
        onConnected();
        return;
      }
      setFlow(next);
      if (next.status !== "pending") notifyError();
    },
    [onConnected, setFlow],
  );
  const settleRef = useRef(settle);
  settleRef.current = settle;
  const setFlowRef = useRef(setFlow);
  setFlowRef.current = setFlow;

  const step = flow?.status === "pending" ? flow.step : undefined;
  const polling = step?.kind === "device_code" || step?.kind === "working";
  const interval = step?.kind === "device_code" ? step.intervalMs : 2000;
  useEffect(() => {
    if (!flow || !polling) return;
    const timer = setTimeout(
      () => {
        void backendClient
          .call("providers.finishOAuth", { flowId: flow.flowId })
          .then((next) => settleRef.current(next))
          .catch((error: unknown) => {
            if (!mounted.current) return;
            setFlowRef.current({ ...flow, status: "failed", error: errorText(error) });
          });
      },
      Math.max(interval, 1000),
    );
    return () => clearTimeout(timer);
  }, [flow, polling, interval]);

  const start = async () => {
    tapLight();
    setStarting(true);
    try {
      const next = await backendClient.call("providers.startOAuth", { provider: provider.id });
      settle(next);
      if (next.step?.kind === "open_url") openExternalUrl(next.step.url);
    } catch (error) {
      notifyError();
      void phoneAlert(`Couldn't start ${method.label}`, errorText(error), "OK");
    } finally {
      if (mounted.current) setStarting(false);
    }
  };

  const cancel = () => {
    if (flow) void backendClient.call("providers.cancelOAuth", { flowId: flow.flowId }).catch(() => {});
    setFlow(null);
    setPasted("");
  };

  const finish = async () => {
    if (!flow || !pasted.trim()) return;
    setFinishing(true);
    try {
      settle(await backendClient.call("providers.finishOAuth", { flowId: flow.flowId, input: pasted.trim() }));
    } catch (error) {
      notifyError();
      void phoneAlert(`Couldn't finish ${method.label}`, errorText(error), "OK");
    } finally {
      if (mounted.current) setFinishing(false);
    }
  };

  if (step?.kind === "device_code") {
    const copyAndOpen = async () => {
      tapLight();
      await engine.writeText(step.userCode).catch(() => false);
      openExternalUrl(step.verificationUri);
    };
    return (
      <col w="full" gap={14}>
        <Note>Enter this code at {hostOf(step.verificationUri)}</Note>
        <box
          role="button"
          label={`Code ${step.userCode.split("").join(" ")}. Tap to copy.`}
          focusable
          selfAlign="start"
          pressScale={0.98}
          onPress={() => {
            tapLight();
            void engine.writeText(step.userCode);
          }}
        >
          <text {...CODE_TEXT} color={c.text} py={4} selectable>
            {step.userCode}
          </text>
        </box>
        <PrimaryButton label="Copy code and open" onPress={() => void copyAndOpen()} />
        <Note>Stella finishes on its own once you approve.</Note>
        <TextAction label="Cancel" tone="muted" onPress={cancel} />
      </col>
    );
  }

  if (step?.kind === "open_url") {
    return (
      <col w="full" gap={14}>
        <Note>{step.instructions ?? `Sign in on ${hostOf(step.url)}, then paste the code it shows here.`}</Note>
        <LineField
          id={`phone-provider-code-${provider.id}`}
          value={pasted}
          onChange={setPasted}
          placeholder="Paste the code"
          onSubmit={() => void finish()}
          trailing={
            pasted ? null : (
              <TextAction
                label="Paste"
                onPress={() =>
                  void readClipboard().then((clip) => {
                    if (clip) setPasted(clip);
                  })
                }
              />
            )
          }
        />
        <PrimaryButton label="Finish signing in" busy={finishing} disabled={!pasted.trim()} onPress={() => void finish()} />
        <row w="full" wrap gap={20}>
          <TextAction label="Open the page again" onPress={() => openExternalUrl(step.url)} />
          <TextAction label="Cancel" tone="muted" onPress={cancel} />
        </row>
      </col>
    );
  }

  if (step?.kind === "working") {
    return (
      <col w="full" gap={14}>
        <Note>{step.message ?? "Finishing sign-in…"}</Note>
        <TextAction label="Cancel" tone="muted" onPress={cancel} />
      </col>
    );
  }

  return (
    <col w="full" gap={14}>
      {flow && flow.status !== "pending" ? <Note tone="danger">{flow.status === "expired" ? "That sign-in timed out. Start again." : (flow.error ?? "That sign-in didn't finish. Start again.")}</Note> : null}
      <PrimaryButton id={`phone-provider-signin-${provider.id}`} label={method.label} busy={starting} onPress={() => void start()} />
      {method.subscription ? <Note>Uses your {provider.label} plan.</Note> : null}
    </col>
  );
}
