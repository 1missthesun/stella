import { createContext, useContext, useMemo, type ReactNode } from "react";
import {
  SHARE_CANVAS_PATTERN,
  type PublishedShare,
  type SavedCanvasShare,
  type SavedDriveDocumentShare,
  type ShareLink,
  type ShareVisibility,
} from "@stella/contracts/backend/shares";
import { backendClient } from "@/platform/backend/backend-client";
import { useBackendView } from "@/platform/backend/use-backend-view";
import { canvasShareBaseUrl } from "@/shared/lib/canvas-share";

export type PublishedCanvasShare = PublishedShare;
export type SharedCanvasLink = ShareLink;
export type CanvasLinkVisibility = ShareVisibility;

export type CanvasShareContextValue = {
  baseUrl: string | null;
  publish: (args: {
    html: string;
    title?: string;
  }) => Promise<PublishedCanvasShare>;
  revoke: (args: { slug: string }) => Promise<void>;
  save: (args: {
    canvas: string;
    html: string;
    title?: string;
    visibility?: ShareVisibility;
  }) => Promise<SavedCanvasShare>;
  saveDriveDocument: (args: {
    canvas: string;
    path: string;
    title?: string;
    visibility?: ShareVisibility;
  }) => Promise<SavedDriveDocumentShare>;
  setVisibility: (args: {
    slug: string;
    visibility: ShareVisibility;
  }) => Promise<SavedCanvasShare>;
  viewLink: (args: { slug: string }) => Promise<string>;
};

const CanvasShareContext = createContext<CanvasShareContextValue | null>(null);

const publish = (args: { html: string; title?: string }) =>
  backendClient.call("shares.publish", args);

const revoke = async ({ slug }: { slug: string }) => {
  await backendClient.call("shares.revoke", { slug });
};

const save: CanvasShareContextValue["save"] = (args) =>
  backendClient.call("shares.save", args);

const saveDriveDocument: CanvasShareContextValue["saveDriveDocument"] = (args) =>
  backendClient.call("shares.saveDriveDocument", args);

const setVisibility: CanvasShareContextValue["setVisibility"] = (args) =>
  backendClient.call("shares.setVisibility", args);

const viewLink = async ({ slug }: { slug: string }) =>
  (await backendClient.call("shares.viewLink", { slug })).url;

export function CanvasShareProvider({ children }: { children: ReactNode }) {
  const value = useMemo<CanvasShareContextValue>(
    () => ({
      baseUrl: canvasShareBaseUrl(),
      publish,
      revoke,
      save,
      saveDriveDocument,
      setVisibility,
      viewLink,
    }),
    [],
  );

  return (
    <CanvasShareContext.Provider value={value}>
      {children}
    </CanvasShareContext.Provider>
  );
}

export const useCanvasShare = (): CanvasShareContextValue | null =>
  useContext(CanvasShareContext);

export const useSharedCanvasLinks = () => useBackendView("shares.list", {});

export const canvasLinkKey = (slug: string | undefined): string | null =>
  slug && SHARE_CANVAS_PATTERN.test(slug) ? slug : null;

export const useCanvasLink = (canvas: string | null) =>
  useBackendView("shares.canvas", canvas ? { canvas } : "skip");
