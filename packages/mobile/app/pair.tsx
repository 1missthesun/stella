import { Redirect, useLocalSearchParams } from "expo-router";
import { formatPairingLink, parsePairingLink } from "@stella/contracts/self-host";
import { selfHostServersAvailable } from "../src/lib/native-capabilities";

/**
 * `stella://pair?server=…&code=…` (or `stella-mobile://pair?…`) opened from
 * the camera app or another app: hand the link to the connect screen, which
 * shows whose server it is before anything is claimed.
 */
export default function PairLinkRoute() {
  const params = useLocalSearchParams<{ server?: string; code?: string }>();
  if (!selfHostServersAvailable) return <Redirect href="/" />;
  const raw = `stella://pair?${new URLSearchParams({
    server: typeof params.server === "string" ? params.server : "",
    code: typeof params.code === "string" ? params.code : "",
  }).toString()}`;
  const link = parsePairingLink(raw);
  return (
    <Redirect
      href={{
        pathname: "/connect-server",
        params: { link: link ? formatPairingLink(link) : raw },
      }}
    />
  );
}
