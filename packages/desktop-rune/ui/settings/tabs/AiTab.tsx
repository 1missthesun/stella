import { SettingsTabContent } from "../parts";
import { SettingsTabHeader } from "../AiryControls";
import { CloudBoundary } from "@/features/cloud/CloudBoundary";
import { ProviderAccountsCard } from "../../global/cloud/ProviderAccountsCard";

export function AiTab() {
  return (
    <SettingsTabContent>
      <SettingsTabHeader titleKey="settings.tabs.ai" />
      <CloudBoundary>
        <ProviderAccountsCard />
      </CloudBoundary>
    </SettingsTabContent>
  );
}
