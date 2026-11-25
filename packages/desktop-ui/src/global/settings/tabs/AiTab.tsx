import { CloudBoundary } from "@/features/cloud/CloudBoundary";
import { ProviderAccountsCard } from "@/features/cloud/ProviderAccountsCard";
import { SettingsTabHeader } from "@/global/settings/AiryControls";

export function AiTab() {
  return (
    <div className="settings-tab-content settings-tab-content--ai">
      <SettingsTabHeader titleKey="settings.tabs.ai" />
      <CloudBoundary>
        <ProviderAccountsCard />
      </CloudBoundary>
    </div>
  );
}
