import { SettingsTabContent as TabColumn } from "./parts";
import { useSettings } from "./settings.styles";
import {
  lazy,
  Suspense,
  useCallback,
  useDeferredValue,
  useEffect,
  useState,
} from "react";
import type { LegalDocument } from "@/global/legal/legal-text";
import { SettingsPanel } from "./SettingsPanel";
import { SettingsSearch } from "./SettingsSearch";
import { SettingsBarNav, SettingsRailNav } from "./SettingsNav";
import { SettingsSearchResults } from "./SettingsSearchResults";
import { AudioTab } from "./AudioTab";
import {
  availableSettingsTabs,
  SETTINGS_TAB_KEYS,
  type SettingsTab,
} from "@/global/settings/settings-tabs";
import { useViewState } from "@/platform/view-state/view-state";
import { AccountTab } from "./tabs/AccountTab";
import { AiTab } from "./tabs/AiTab";
import { GeneralTab } from "./tabs/GeneralTab";
import { ShortcutsTab } from "./tabs/ShortcutsTab";
import { PrivacyTab } from "./tabs/PrivacyTab";
import type { ScoredSettingsSearchEntry } from "@/global/settings/lib/settings-search-index";
import { useT } from "@/shared/i18n";
import {
  clearPendingSettingsCard,
  requestSettingsCard,
} from "./settings-card-targets";
import { platformCapabilities } from "@/platform/capabilities";

const SecureValuesCard = lazy(() =>
  import("./tabs/SecureValuesCard").then((module) => ({
    default: module.SecureValuesCard,
  })),
);

const LegalDialog = lazy(() =>
  import("../global/legal/LegalDialog").then((m) => ({
    default: m.LegalDialog,
  })),
);

const NARROW_WIDTH = 720;

export type { SettingsTab };

interface SettingsScreenProps {
  activeTab?: SettingsTab;
  onActiveTabChange?: (tab: SettingsTab) => void;
  onSignOut?: () => void;
  embedded?: boolean;
}

export const SettingsScreen = ({
  activeTab: activeTabProp,
  onActiveTabChange,
  onSignOut,
  embedded = false,
}: SettingsScreenProps) => {
  const s = useSettings();
  const [selectedTab, setSelectedTab] = useViewState<SettingsTab>(
    "settings.tab",
    "general",
    (value) => (SETTINGS_TAB_KEYS as readonly unknown[]).includes(value),
  );
  const [activeLegalDoc, setActiveLegalDoc] = useState<LegalDocument | null>(
    null,
  );
  const [searchQuery, setSearchQuery] = useState("");
  const t = useT();

  const activeTab = activeTabProp ?? selectedTab;

  const deferredQuery = useDeferredValue(searchQuery);
  const isSearching = deferredQuery.trim().length > 0;

  const handleTabClick = useCallback(
    (next: SettingsTab) => {
      if (activeTabProp === undefined) {
        setSelectedTab(next);
      }
      onActiveTabChange?.(next);
    },
    [activeTabProp, onActiveTabChange],
  );

  const handleResultSelect = useCallback(
    (result: ScoredSettingsSearchEntry) => {
      setSearchQuery("");
      handleTabClick(result.tab);
      requestSettingsCard(result.cardKey);
    },
    [handleTabClick],
  );

  useEffect(() => clearPendingSettingsCard, []);

  const [narrow, setNarrow] = useState(embedded);
  const measure = useCallback(
    (r: { w: number }) => {
      if (!embedded) setNarrow(r.w < NARROW_WIDTH);
    },
    [embedded],
  );

  const tabs = availableSettingsTabs(platformCapabilities.website);
  const handleNavSelect = useCallback(
    (tab: SettingsTab) => {
      if (isSearching) setSearchQuery("");
      clearPendingSettingsCard();
      handleTabClick(tab);
    },
    [handleTabClick, isSearching],
  );
  const navProps = {
    tabs,
    activeTab: isSearching ? null : activeTab,
    onSelect: handleNavSelect,
    label: t("settings.title"),
  };

  const Layout = narrow ? "col" : "row";
  return (
    <>
      <col {...s.settingsScreen} onLayout={measure}>
        <Layout {...s.settingsLayout}>
          <col {...(narrow ? s.settingsLayoutBar_settingsNav : s.settingsLayoutRail_settingsNav)}>
            <SettingsSearch value={searchQuery} onChange={setSearchQuery} />
            {narrow ? (
              <SettingsBarNav {...navProps} />
            ) : (
              <SettingsRailNav {...navProps} />
            )}
          </col>
          <SettingsPanel narrow={narrow} scrollResetKey={isSearching ? "search" : activeTab}>
            {isSearching ? (
              <SettingsSearchResults query={deferredQuery} onSelect={handleResultSelect} onClear={() => setSearchQuery("")} />
            ) : (
              <col id={`settings-tabpanel-${activeTab}`} role="tabpanel">
                <SettingsTabContent activeTab={activeTab} onSignOut={onSignOut} onOpenLegal={setActiveLegalDoc} />
              </col>
            )}
          </SettingsPanel>
        </Layout>
      </col>
      <Suspense fallback={null}>
        <LegalDialog document={activeLegalDoc} onOpenChange={(open) => {
            if (!open) setActiveLegalDoc(null);
          }} />
      </Suspense>
    </>
  );
};

interface SettingsTabContentProps {
  activeTab: SettingsTab;
  onSignOut?: () => void;
  onOpenLegal: (doc: LegalDocument) => void;
}

function SettingsTabContent({
  activeTab,
  onSignOut,
  onOpenLegal,
}: SettingsTabContentProps) {
  const s = useSettings();
  return (
    <col {...s.settingsPanelContent}>
      {activeTab === "general" ? (
        <GeneralTab />
      ) : activeTab === "shortcuts" && platformCapabilities.shortcuts ? (
        <ShortcutsTab />
      ) : activeTab === "ai" ? (
        <AiTab />
      ) : activeTab === "account" ? (
        <AccountTab onSignOut={onSignOut} onOpenLegal={onOpenLegal} />
      ) : activeTab === "audio" ? (
        <AudioTab />
      ) : activeTab === "privacy" ? (
        <PrivacyTab />
      ) : activeTab === "savedValues" && platformCapabilities.nativeSettings ? (
        <TabColumn>
          <Suspense fallback={null}>
            <SecureValuesCard />
          </Suspense>
        </TabColumn>
      ) : (
        <GeneralTab />
      )}
    </col>
  );
}
