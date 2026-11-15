import { CloudBoundary } from "@/features/cloud/CloudBoundary";
import { ProviderAccountsCard } from "@/features/cloud/ProviderAccountsCard";

export function AiTab() {
  return (
    <div className="settings-tab-content settings-tab-content--ai">
      <CloudBoundary>
        <ProviderAccountsCard />
      </CloudBoundary>
    </div>
  );
}
