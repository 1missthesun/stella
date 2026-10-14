import { useMemo } from "react";
import type { Plugin } from "unified";
import type { Image, Parent, Root } from "mdast";
import { resolveRelativeHtmlAsset } from "@stella/contracts/html-relative-assets";
import { useDisplayFileBlobs } from "@/shared/hooks/use-display-file-data";

export const STELLA_DOCUMENT_IMAGE_TAG = "stella-document-image";
export const STELLA_DOCUMENT_IMAGE_TAG_ATTRIBUTES = ["path", "alt"] as const;

const visitImages = (parent: Parent, documentPath: string) => {
  for (const child of parent.children) {
    if (child.type === "image") {
      const image = child as Image;
      const assetPath = resolveRelativeHtmlAsset(documentPath, image.url);
      if (assetPath) {
        image.data = {
          ...image.data,
          hName: STELLA_DOCUMENT_IMAGE_TAG,
          hProperties: { path: assetPath, alt: image.alt ?? "" },
        };
      }
      continue;
    }
    if ("children" in child && Array.isArray(child.children)) {
      visitImages(child as Parent, documentPath);
    }
  }
};

export const remarkDocumentImages: Plugin<[string], Root> = (documentPath) => (tree) => {
  visitImages(tree, documentPath);
};

export const MarkdownDocumentImage = ({
  path,
  alt,
}: {
  path?: unknown;
  alt?: unknown;
  node?: unknown;
}) => {
  const assetPath = typeof path === "string" ? path : "";
  const label = typeof alt === "string" ? alt : "";
  const paths = useMemo(() => (assetPath ? [assetPath] : []), [assetPath]);
  const { files } = useDisplayFileBlobs(paths);
  const url = files[0]?.url;
  return url ? (
    <img src={url} alt={label} />
  ) : (
    <span role="img" aria-label={label} />
  );
};
