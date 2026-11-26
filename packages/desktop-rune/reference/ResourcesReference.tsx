import "@/shell/full-shell.layout.css";
import "@/app/chat/pdf-viewer-card.css";
import { DisplayFileSourceContext } from "@/shared/hooks/display-file-source";
import { InlineGeneratedImageStrip } from "@/app/chat/InlineGeneratedImageCard";
import { MapRouteCards } from "@/app/chat/MapRouteCard";
import { SourceDiffEndResource } from "@/app/chat/SourceDiffEndResource";
import { OfficePreviewCard } from "@/app/chat/OfficePreviewCard";
import { ConnectorConnectCard } from "@/app/chat/ConnectorConnectCard";
import { PdfViewerCard } from "@/app/chat/PdfViewerCard";
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
} from "../ui/chat/fixtures/resources";

installResourceStubs();

const REPO = `${import.meta.env.VITE_STELLA_REPO}/`;
const SOURCE = resourceFileSource(async (repoPath) => new Uint8Array(await (await fetch(`/@fs${REPO}${repoPath}`)).arrayBuffer()));
const COLUMN = { position: "absolute", top: 24, width: 620, display: "flex", flexDirection: "column", gap: 16 } as const;

/** desktop-ui's resource cards over the same fixture files as ui/chat/fixtures/ResourcesFixture.tsx. */
export function ResourcesReference() {
  const part = new URLSearchParams(location.search).get("part") === "b" ? "b" : "a";
  return (
    <div className="full-body-main" style={{ position: "fixed", inset: 0 }}>
      <DisplayFileSourceContext.Provider value={SOURCE}>
        <div className="session-content" style={{ position: "absolute", inset: 0 }}>
          {part === "a" ? (
            <>
              <div style={{ ...COLUMN, left: 66 }}>
                <InlineGeneratedImageStrip payloads={RESOURCE_SINGLE_IMAGE} conversationId={RESOURCES_FIXTURE_CONVERSATION} />
                <InlineGeneratedImageStrip payloads={RESOURCE_PENDING_IMAGE} conversationId={RESOURCES_FIXTURE_CONVERSATION} />
              </div>
              <div style={{ ...COLUMN, left: 714 }}>
                <InlineGeneratedImageStrip payloads={RESOURCE_IMAGE_STRIP} conversationId={RESOURCES_FIXTURE_CONVERSATION} />
                <MapRouteCards cards={RESOURCE_MAP} />
                <SourceDiffEndResource batchId="fixture-diff-one" payloads={RESOURCE_SOURCE_DIFF_ONE} />
                <SourceDiffEndResource batchId="fixture-diff-many" payloads={RESOURCE_SOURCE_DIFF_MANY} />
              </div>
            </>
          ) : (
            <>
              <div style={{ ...COLUMN, left: 66 }}>
                <ConnectorConnectCard conversationId={RESOURCE_CONNECT_REQUEST.conversationId} />
                <OfficePreviewCard previewRef={RESOURCE_OFFICE_REF} />
              </div>
              <div style={{ ...COLUMN, left: 714, height: 860 }}>
                <PdfViewerCard filePath={RESOURCE_PDF_PATH} title="Lisbon itinerary" />
              </div>
            </>
          )}
        </div>
      </DisplayFileSourceContext.Provider>
    </div>
  );
}
