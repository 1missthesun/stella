import { useEffect, useRef } from "react";
import { ActivityIndicator, Alert, View } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { parseConnectClaimLink } from "@stella/contracts/backend/integrations";
import { getBackendClient } from "../src/lib/backend";
import { useT } from "../src/i18n";

/**
 * stella://connect?code=… — a Google sign-in finished in the browser hands
 * its one-time code to this app, which redeems it as the signed-in Stella
 * user. A code made for anyone else does nothing.
 */
export default function ConnectClaimRoute() {
  const params = useLocalSearchParams<{ code?: string }>();
  const router = useRouter();
  const t = useT();
  const started = useRef(false);

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    const code = parseConnectClaimLink(
      `stella://connect?code=${encodeURIComponent(typeof params.code === "string" ? params.code : "")}`,
    );
    const finish = (title: string, body: string) => {
      Alert.alert(title, body);
      router.replace("/");
    };
    if (!code) {
      finish(t("cloudConnector.googleClaim.failed"), t("cloudConnector.googleClaim.failedBody"));
      return;
    }
    getBackendClient()
      .call("integrations.finishConnect", { connectCode: code })
      .then(
        ({ email }) =>
          finish(
            t("cloudConnector.googleClaim.connected"),
            t("cloudConnector.googleClaim.connectedBody", { email }),
          ),
        () => finish(t("cloudConnector.googleClaim.failed"), t("cloudConnector.googleClaim.failedBody")),
      );
  }, [params.code, router, t]);

  return (
    <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}>
      <ActivityIndicator />
    </View>
  );
}
