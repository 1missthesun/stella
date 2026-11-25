import { SettingsTabContent } from "../parts";
import { CloudBoundary } from "@/features/cloud/CloudBoundary";
import { ProviderAccountsCard } from "../../global/cloud/ProviderAccountsCard";

export function AiTab() {
  return (
    <SettingsTabContent>
      <CloudBoundary>
        <ProviderAccountsCard />
      </CloudBoundary>
    </SettingsTabContent>
  );
}
