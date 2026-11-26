import { join } from "node:path";
import { I18nProvider } from "@/shared/i18n/RemoteI18nProvider";
import { DisplayFileSourceContext } from "@/shared/hooks/display-file-source";
import { GALLERY_THEMES } from "../../gallery/spec";
import { ThemeBackdrop, ThemeScope } from "../../theme";
import { InlineGeneratedImageStrip } from "../cards/InlineGeneratedImageCard";
import { MapRouteCards } from "../cards/MapRouteCard";
import { SourceDiffEndResource } from "../cards/SourceDiffEndResource";
import { OfficePreviewCard } from "../cards/OfficePreviewCard";
import { ConnectorConnectCard } from "../ConnectorConnectCard";
import { PdfViewerCard } from "../../shell/display/PdfViewerCard";
import {
  installResourceStubs,
  RESOURCE_CONNECT_REQUEST,
  RESOURCE_IMAGE_STRIP,
  RESOURCE_MAP,
  RESOURCE_OFFICE_REF,
  RESOURCE_PDF_PATH,
  RESOURCE_PENDING_IMAGE,
  RESOURCE_SINGLE_IMAGE,
  RESOURCE_SOURCE_DIFF_MANY,
  RESOURCE_SOURCE_DIFF_ONE,
  RESOURCES_FIXTURE_CONVERSATION,
  resourceFileSource,
} from "./resources";

installResourceStubs();

const REPO = join(process.env.STELLA_RUNE_ROOT ?? process.cwd(), "../..");
const SOURCE = resourceFileSource((repoPath) => Bun.file(join(REPO, repoPath)).bytes());
const PART = process.env.STELLA_CHAT_FIXTURE_PART === "b" ? "b" : "a";

function Resources() {
  return (
    <col w="full" h="full">
      <ThemeBackdrop id="resources-fixture-backdrop" />
      <DisplayFileSourceContext.Provider value={SOURCE}>
        <box w="full" h="full">
          {PART === "a" ? (
            <>
              <col absolute={{ top: 24, left: 66 }} w={620} gap={16}>
                <InlineGeneratedImageStrip payloads={RESOURCE_SINGLE_IMAGE} conversationId={RESOURCES_FIXTURE_CONVERSATION} />
                <InlineGeneratedImageStrip payloads={RESOURCE_PENDING_IMAGE} conversationId={RESOURCES_FIXTURE_CONVERSATION} />
              </col>
              <col absolute={{ top: 24, left: 714 }} w={620} gap={16}>
                <InlineGeneratedImageStrip payloads={RESOURCE_IMAGE_STRIP} conversationId={RESOURCES_FIXTURE_CONVERSATION} />
                <MapRouteCards cards={RESOURCE_MAP} />
                <SourceDiffEndResource batchId="fixture-diff-one" payloads={RESOURCE_SOURCE_DIFF_ONE} />
                <SourceDiffEndResource batchId="fixture-diff-many" payloads={RESOURCE_SOURCE_DIFF_MANY} />
              </col>
            </>
          ) : (
            <>
              <col absolute={{ top: 24, left: 66 }} w={620} gap={16}>
                <ConnectorConnectCard conversationId={RESOURCE_CONNECT_REQUEST.conversationId} />
                <OfficePreviewCard previewRef={RESOURCE_OFFICE_REF} />
              </col>
              <col absolute={{ top: 24, left: 714 }} w={620} h={860}>
                <PdfViewerCard filePath={RESOURCE_PDF_PATH} title="Lisbon itinerary" />
              </col>
            </>
          )}
        </box>
      </DisplayFileSourceContext.Provider>
    </col>
  );
}

/** desktop-ui's resource cards over fixture files, for side-by-sides with reference/?page=resources (`STELLA_CHAT_FIXTURE_THEME`, `STELLA_CHAT_FIXTURE_PART` a | b). */
export function App() {
  const requested = process.env.STELLA_CHAT_FIXTURE_THEME ?? "dark";
  const key = (requested in GALLERY_THEMES ? requested : "dark") as keyof typeof GALLERY_THEMES;
  const theme = GALLERY_THEMES[key];
  return (
    <I18nProvider>
      <ThemeScope themeId={theme.themeId} mode={theme.mode} customBase={theme.base}>
        <Resources />
      </ThemeScope>
    </I18nProvider>
  );
}

export function initialState() {
  return { error: null, swaps: 0, lastSwapMs: null };
}
