import { useCallback, useEffect, useRef, useState } from "react";
import { Alert, Pressable, StyleSheet, Text, View } from "react-native";
import * as Clipboard from "expo-clipboard";
import * as WebBrowser from "expo-web-browser";
import type {
  AccountProvider,
  ProviderAuthMethod,
  ProviderOAuthFlow,
} from "@stella/contracts/backend/providers";
import { getBackendClient } from "../../lib/backend";
import { notifyError, notifySuccess, tapLight } from "../../lib/haptics";
import { CONTENT_MAX_FONT_SCALE } from "../../lib/setup-text-defaults";
import { userFacingError } from "../../lib/user-facing-error";
import type { Colors } from "../../theme/colors";
import { fonts } from "../../theme/fonts";
import { useColors } from "../../theme/theme-context";
import { LineField, Note, PrimaryButton, TextAction } from "./kit";

type OAuthMethod = Extract<ProviderAuthMethod, { kind: "oauth" }>;
type KeyMethod = Extract<ProviderAuthMethod, { kind: "api_key" }>;

const errorReason = (error: unknown) =>
  error && typeof error === "object" && "reason" in error
    ? (error as { reason?: unknown }).reason
    : undefined;

const openPage = (url: string) =>
  WebBrowser.openBrowserAsync(url, {
    presentationStyle: WebBrowser.WebBrowserPresentationStyle.PAGE_SHEET,
  });

const hostOf = (url: string) => {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
};

/**
 * Connecting one provider to the account: its sign-in when it has one, and
 * its API key. The secret goes straight to the server, which checks it with
 * the provider and keeps it; nothing here stores it.
 */
export function ProviderConnect({
  provider,
  onConnected,
}: {
  provider: AccountProvider;
  onConnected: () => void;
}) {
  const colors = useColors();
  const styles = makeStyles(colors);
  const oauth = provider.authMethods.find(
    (method): method is OAuthMethod => method.kind === "oauth",
  );
  const keyMethod = provider.authMethods.find(
    (method): method is KeyMethod => method.kind === "api_key",
  );
  const [flow, setFlow] = useState<ProviderOAuthFlow | null>(null);
  const [starting, setStarting] = useState(false);

  const signIn = oauth ? (
    <SignIn
      provider={provider}
      method={oauth}
      flow={flow}
      setFlow={setFlow}
      starting={starting}
      setStarting={setStarting}
      onConnected={onConnected}
    />
  ) : null;

  const signingIn = flow?.status === "pending";

  return (
    <View style={styles.stack}>
      {signIn}
      {keyMethod && !signingIn ? (
        <ApiKeyForm
          provider={provider}
          method={keyMethod}
          secondary={Boolean(oauth)}
          onConnected={onConnected}
        />
      ) : null}
    </View>
  );
}

function ApiKeyForm({
  provider,
  method,
  secondary,
  onConnected,
}: {
  provider: AccountProvider;
  method: KeyMethod;
  secondary: boolean;
  onConnected: () => void;
}) {
  const colors = useColors();
  const styles = makeStyles(colors);
  const [key, setKey] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const save = async (value = key) => {
    const apiKey = value.trim();
    if (!apiKey || saving) return;
    setSaving(true);
    setError(null);
    try {
      await getBackendClient().call("providers.setApiKey", {
        provider: provider.id,
        apiKey,
      });
      setKey("");
      notifySuccess();
      onConnected();
    } catch (cause) {
      notifyError();
      setError(
        errorReason(cause) === "invalid_api_key"
          ? `${provider.label} didn't accept that key. Check it and try again.`
          : userFacingError(cause),
      );
    } finally {
      setSaving(false);
    }
  };

  const paste = async () => {
    const clip = (await Clipboard.getStringAsync().catch(() => "")).trim();
    if (clip) {
      setKey(clip);
      setError(null);
    }
  };

  return (
    <View style={styles.block}>
      {secondary ? <Note>Or use an API key</Note> : null}
      <LineField
        value={key}
        onChangeText={(text) => {
          setKey(text);
          setError(null);
        }}
        placeholder={
          /[a-z0-9]/i.test(method.placeholder) ? method.placeholder : "API key"
        }
        secureTextEntry
        autoCapitalize="none"
        autoCorrect={false}
        autoComplete="off"
        textContentType="password"
        returnKeyType="done"
        onSubmitEditing={() => void save()}
        accessibilityLabel={`${provider.label} API key`}
        trailing={
          key ? null : <TextAction label="Paste" onPress={() => void paste()} />
        }
      />
      {error ? <Note tone="danger">{error}</Note> : null}
      <PrimaryButton
        label="Save key"
        busy={saving}
        disabled={!key.trim()}
        onPress={() => void save()}
      />
      {method.keyUrl ? (
        <TextAction
          label="Get a key"
          icon="external-link"
          tone="muted"
          onPress={() => void openPage(method.keyUrl as string)}
        />
      ) : null}
    </View>
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
  const colors = useColors();
  const styles = makeStyles(colors);
  const [pasted, setPasted] = useState("");
  const [finishing, setFinishing] = useState(false);
  const flowRef = useRef(flow);
  flowRef.current = flow;
  const mounted = useRef(true);
  useEffect(
    () => () => {
      mounted.current = false;
      const open = flowRef.current;
      if (open?.status === "pending") {
        void getBackendClient()
          .call("providers.cancelOAuth", { flowId: open.flowId })
          .catch(() => {});
      }
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
        void getBackendClient()
          .call("providers.finishOAuth", { flowId: flow.flowId })
          .then((next) => settleRef.current(next))
          .catch((error: unknown) => {
            if (!mounted.current) return;
            setFlowRef.current({
              ...flow,
              status: "failed",
              error: userFacingError(error),
            });
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
      const next = await getBackendClient().call("providers.startOAuth", {
        provider: provider.id,
      });
      settle(next);
      if (next.step?.kind === "open_url") await openPage(next.step.url);
    } catch (error) {
      notifyError();
      Alert.alert(`Couldn't start ${method.label}`, userFacingError(error));
    } finally {
      if (mounted.current) setStarting(false);
    }
  };

  const cancel = () => {
    if (flow) {
      void getBackendClient()
        .call("providers.cancelOAuth", { flowId: flow.flowId })
        .catch(() => {});
    }
    setFlow(null);
    setPasted("");
  };

  const finish = async (input = pasted) => {
    if (!flow || !input.trim()) return;
    setFinishing(true);
    try {
      settle(
        await getBackendClient().call("providers.finishOAuth", {
          flowId: flow.flowId,
          input: input.trim(),
        }),
      );
    } catch (error) {
      notifyError();
      Alert.alert(`Couldn't finish ${method.label}`, userFacingError(error));
    } finally {
      if (mounted.current) setFinishing(false);
    }
  };

  if (step?.kind === "device_code") {
    const copyAndOpen = async () => {
      tapLight();
      await Clipboard.setStringAsync(step.userCode).catch(() => {});
      await openPage(step.verificationUri);
    };
    return (
      <View style={styles.block}>
        <Note>Enter this code at {hostOf(step.verificationUri)}</Note>
        <Pressable
          onPress={() => {
            tapLight();
            void Clipboard.setStringAsync(step.userCode);
          }}
          accessibilityRole="button"
          accessibilityLabel={`Code ${step.userCode.split("").join(" ")}. Tap to copy.`}
        >
          <Text
            style={styles.code}
            selectable
            maxFontSizeMultiplier={CONTENT_MAX_FONT_SCALE}
          >
            {step.userCode}
          </Text>
        </Pressable>
        <PrimaryButton
          label="Copy code and open"
          onPress={() => void copyAndOpen()}
        />
        <Note>Stella finishes on its own once you approve.</Note>
        <TextAction label="Cancel" tone="muted" onPress={cancel} />
      </View>
    );
  }

  if (step?.kind === "open_url") {
    return (
      <View style={styles.block}>
        <Note>
          {step.instructions ??
            `Sign in on ${hostOf(step.url)}, then paste the code it shows here.`}
        </Note>
        <LineField
          value={pasted}
          onChangeText={setPasted}
          placeholder="Paste the code"
          autoCapitalize="none"
          autoCorrect={false}
          returnKeyType="done"
          onSubmitEditing={() => void finish()}
          trailing={
            pasted ? null : (
              <TextAction
                label="Paste"
                onPress={() =>
                  void Clipboard.getStringAsync().then((clip) => {
                    if (clip.trim()) setPasted(clip.trim());
                  })
                }
              />
            )
          }
        />
        <PrimaryButton
          label="Finish signing in"
          busy={finishing}
          disabled={!pasted.trim()}
          onPress={() => void finish()}
        />
        <View style={styles.row}>
          <TextAction
            label="Open the page again"
            onPress={() => void openPage(step.url)}
          />
          <TextAction label="Cancel" tone="muted" onPress={cancel} />
        </View>
      </View>
    );
  }

  if (step?.kind === "working") {
    return (
      <View style={styles.block}>
        <Note>{step.message ?? "Finishing sign-in…"}</Note>
        <TextAction label="Cancel" tone="muted" onPress={cancel} />
      </View>
    );
  }

  return (
    <View style={styles.block}>
      {flow && flow.status !== "pending" ? (
        <Note tone="danger">
          {flow.status === "expired"
            ? "That sign-in timed out. Start again."
            : (flow.error ?? "That sign-in didn't finish. Start again.")}
        </Note>
      ) : null}
      <PrimaryButton
        label={method.label}
        busy={starting}
        onPress={() => void start()}
      />
      {method.subscription ? (
        <Note>Uses your {provider.label} plan.</Note>
      ) : null}
    </View>
  );
}

const makeStyles = (colors: Colors) =>
  StyleSheet.create({
    stack: {
      gap: 26,
    },
    block: {
      gap: 14,
    },
    row: {
      flexDirection: "row",
      flexWrap: "wrap",
      gap: 20,
    },
    code: {
      color: colors.text,
      fontFamily: fonts.mono.medium,
      fontSize: 32,
      letterSpacing: 3,
      paddingVertical: 4,
    },
  });
