import { useRouter } from "expo-router";
import { CloudHomeSettings } from "../../src/components/CloudHomeSettings";
import { MainDetailSurface } from "../../src/components/MainScreenSurface";
import { authClient } from "../../src/lib/auth-client";
import { observeCloudConversationIdentity } from "../../src/lib/cloud-conversation-auth";

export default function CloudHomeScreen() {
  const router = useRouter();
  const session = authClient.useSession();
  const identity = observeCloudConversationIdentity(session.data ?? null);

  return (
    <MainDetailSurface>
      <CloudHomeSettings
        key={identity?.identityKey ?? "signed-out"}
        identity={identity}
        onSignIn={() => router.replace("/login")}
      />
    </MainDetailSurface>
  );
}
