import { SettingsCard, SettingsRow } from "../../settings/parts";
import { T } from "../../kit/compat";
import { useSettings } from "../../settings/settings.styles";
import { CloudProjectsCard } from "./CloudProjectsCard";
import { CloudBrowserDataCard } from "./CloudBrowserDataCard";
import { CloudBoundary } from "@/features/cloud/CloudBoundary";
import { useCloudConversationSession } from "@/global/auth/hooks/use-cloud-conversation-session";

const unavailable = (label: string) => <Unavailable label={label} />;

function Unavailable({ label }: { label: string }) {
  const s = useSettings();
  return (
  <SettingsCard role="alert">
    <T role="heading" {...s.settingsCardTitle}>{label}</T>
    <SettingsRow>
      <T {...s.settingsRowSublabel}>
        This cloud control is unavailable right now.
      </T>
    </SettingsRow>
  </SettingsCard>
  );
}

function AccountScopedCloudCards() {
  return (
    <>
      <CloudBoundary fallback={unavailable("Cloud projects")}>
        <CloudProjectsCard />
      </CloudBoundary>
      <CloudBoundary fallback={unavailable("Cloud browser data")}>
        <CloudBrowserDataCard />
      </CloudBoundary>
    </>
  );
}

export function CloudAccountCards() {
  const { isCloudConversationReady, accountScope } =
    useCloudConversationSession();
  if (!isCloudConversationReady) return null;
  return <AccountScopedCloudCards key={accountScope} />;
}
