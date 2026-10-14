import { Redirect, useLocalSearchParams } from "expo-router";
import { formatPairingLink, parsePairingLink } from "@stella/contracts/self-host";
import { selfHostServersAvailable } from "../src/lib/native-capabilities";

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
