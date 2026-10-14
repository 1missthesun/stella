import {
  lazy,
  Suspense,
  useCallback,
  useDeferredValue,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import type { LegalDocument } from "@/global/legal/legal-text";
import { SettingsPanel } from "@/global/settings/SettingsPanel";
import { SettingsSearch } from "@/global/settings/SettingsSearch";
import { SettingsBarNav, SettingsRailNav } from "@/global/settings/SettingsNav";
import { SettingsSearchResults } from "@/global/settings/SettingsSearchResults";
import { AudioTab } from "@/global/settings/AudioTab";
import {
  availableSettingsTabs,
  type SettingsTab,
} from "@/global/settings/settings-tabs";
import { AccountTab } from "./tabs/AccountTab";
import { GeneralTab } from "./tabs/GeneralTab";
import { ShortcutsTab } from "./tabs/ShortcutsTab";
import { PrivacyTab } from "./tabs/PrivacyTab";
import type { ScoredSettingsSearchEntry } from "@/global/settings/lib/settings-search-index";
import { useT } from "@/shared/i18n";
import {
  clearPendingSettingsCard,
  requestSettingsCard,
} from "@/global/settings/settings-card-targets";
import "@/global/settings/settings.css";
import { platformCapabilities } from "@/platform/capabilities";

const LegalDialog = lazy(() =>
  import("@/global/legal/LegalDialog").then((m) => ({
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
  const [selectedTab, setSelectedTab] = useState<SettingsTab>("general");
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

  const screenRef = useRef<HTMLDivElement>(null);
  const [narrow, setNarrow] = useState(embedded);
  useLayoutEffect(() => {
    const screen = screenRef.current;
    if (!screen || embedded) return;
    const measure = () => setNarrow(screen.clientWidth < NARROW_WIDTH);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(screen);
    return () => observer.disconnect();
  }, [embedded]);

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

  return (
    <>
      <div
        ref={screenRef}
        className="settings-screen"
        data-search-active={isSearching ? "true" : "false"}
      >
        <div
          className={`settings-layout ${
            narrow ? "settings-layout--bar" : "settings-layout--rail"
          }`}
        >
          <header className="settings-nav">
            <SettingsSearch value={searchQuery} onChange={setSearchQuery} />
            {narrow ? (
              <SettingsBarNav {...navProps} />
            ) : (
              <SettingsRailNav {...navProps} />
            )}
          </header>
          <SettingsPanel scrollResetKey={isSearching ? "search" : activeTab}>
            {isSearching ? (
              <SettingsSearchResults
                query={deferredQuery}
                onSelect={handleResultSelect}
                onClear={() => setSearchQuery("")}
              />
            ) : (
              <div
                id={`settings-tabpanel-${activeTab}`}
                role="tabpanel"
                aria-labelledby={`settings-tab-${activeTab}`}
              >
                <SettingsTabContent
                  activeTab={activeTab}
                  onSignOut={onSignOut}
                  onOpenLegal={setActiveLegalDoc}
                />
              </div>
            )}
          </SettingsPanel>
        </div>
      </div>
      <Suspense fallback={null}>
        <LegalDialog
          document={activeLegalDoc}
          onOpenChange={(open) => {
            if (!open) setActiveLegalDoc(null);
          }}
        />
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
  return (
    <div className="settings-panel-content">
      {activeTab === "general" ? (
        <GeneralTab />
      ) : activeTab === "shortcuts" && platformCapabilities.shortcuts ? (
        <ShortcutsTab />
      ) : activeTab === "account" ? (
        <AccountTab onSignOut={onSignOut} onOpenLegal={onOpenLegal} />
      ) : activeTab === "audio" ? (
        <AudioTab />
      ) : activeTab === "privacy" ? (
        <PrivacyTab />
      ) : (
        <GeneralTab />
      )}
    </div>
  );
}
