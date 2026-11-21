/**
 * Saving a generated image or file the app shows into ~/.stella/media/outputs:
 * download it (public URLs only) or decode its data URL, check the bytes are
 * what the name says, and write it once. Runs in the runtime with the other
 * media tools; the app only asks.
 */
import fs from "node:fs/promises";
import path from "node:path";
import { fetchPublicUrl, normalizeSafeExternalUrl } from "../../kernel/tools/network-guards.js";
import {
  decodeAndValidateImage,
  decodeBase64ImageBounded,
  readResponseBodyBounded,
  validateDecodedImageFile,
} from "../../kernel/tools/image-decode-validation.js";
import { materializeMediaArtifact } from "../../kernel/tools/media-artifact-store.js";

const MEDIA_FETCH_TIMEOUT_MS = 30_000;

const resolveMediaOutputPath = (dir: string, fileName: string) => {
    if (!fileName ||
        fileName === "." ||
        fileName === ".." ||
        fileName.includes("\0") ||
        fileName.includes("/") ||
        fileName.includes("\\") ||
        path.isAbsolute(fileName)) {
        throw new Error("Invalid media output filename.");
    }
    const resolvedDir = path.resolve(dir);
    const destPath = path.resolve(resolvedDir, fileName);
    if (!destPath.startsWith(`${resolvedDir}${path.sep}`)) {
        throw new Error("Invalid media output filename.");
    }
    return destPath;
};
const normalizedImageOutputPath = (requestedPath: string, mimeType: string) => {
    const extension = mimeType === "image/jpeg"
        ? ".jpg"
        : mimeType === "image/png"
            ? ".png"
            : mimeType === "image/gif"
                ? ".gif"
                : mimeType === "image/webp"
                    ? ".webp"
                    : null;
    if (!extension)
        throw new Error("Downloaded image format is unsupported.");
    const parsed = path.parse(requestedPath);
    return path.join(parsed.dir, `${parsed.name}${extension}`);
};

export const saveMediaOutput = async (
    stellaDataDir: string,
    request: { url?: unknown; fileName?: unknown; kind?: unknown },
): Promise<{ ok: true; path: string } | { ok: false; error: string }> => {
    const payload = {
        url: typeof request.url === "string" ? request.url : "",
        fileName: typeof request.fileName === "string" ? request.fileName : "",
        kind: typeof request.kind === "string" ? request.kind : "",
    };
        try {
        const dir = path.join(stellaDataDir, "media", "outputs");
        await fs.mkdir(dir, { recursive: true });
        let destPath = resolveMediaOutputPath(dir, payload.fileName);
        const declaredImage = /\.(?:png|jpe?g|gif|webp)$/i.test(destPath);
        const expectedImageMime = /\.png$/i.test(destPath)
            ? "image/png"
            : /\.jpe?g$/i.test(destPath)
                ? "image/jpeg"
                : /\.gif$/i.test(destPath)
                    ? "image/gif"
                    : /\.webp$/i.test(destPath)
                        ? "image/webp"
                        : undefined;
        const validateExisting = expectedImageMime
            ? async (candidate: string) => await validateDecodedImageFile(candidate, expectedImageMime)
            : undefined;
        const dataUriMatch = payload.url.match(/^data:([^;,]+);base64,(.+)$/is);
        if (dataUriMatch) {
            const bytes = decodeBase64ImageBounded(dataUriMatch[2]);
            const decoded = await decodeAndValidateImage(bytes);
            if (!decoded || decoded.mimeType !== dataUriMatch[1]?.toLowerCase()) {
                throw new Error("Image payload MIME type does not match its decoded bytes.");
            }
            if (payload.kind === "image") {
                destPath = normalizedImageOutputPath(destPath, decoded.mimeType);
            }
            const normalizedExpectedMime = payload.kind === "image" ? decoded.mimeType : expectedImageMime;
            const saved = await materializeMediaArtifact({
                filePath: destPath,
                validateExisting: async (candidate: string) => await validateDecodedImageFile(candidate, normalizedExpectedMime ?? dataUriMatch[1]?.toLowerCase()),
                producer: async () => {
                    if (payload.kind !== "image" &&
                        expectedImageMime &&
                        decoded.mimeType !== expectedImageMime) {
                        throw new Error("Image payload MIME type does not match its decoded bytes.");
                    }
                    if (payload.kind !== "image" && !expectedImageMime) {
                        throw new Error("Image output requires an extension matching its decoded bytes.");
                    }
                    return bytes;
                },
            });
            return { ok: true, path: saved.path };
        }
        const safeUrl = normalizeSafeExternalUrl(payload.url);
        if (payload.kind === "image") {
            const signal = AbortSignal.timeout(MEDIA_FETCH_TIMEOUT_MS);
            const response = await fetchPublicUrl(safeUrl, {
                headers: { "User-Agent": "StellaDesktop/1.0" },
                signal,
            });
            if (!response.ok) {
                throw new Error(`Download failed (${response.status})`);
            }
            const bytes = await readResponseBodyBounded(response, { signal });
            const decoded = await decodeAndValidateImage(bytes);
            if (!decoded) {
                throw new Error("Downloaded image is invalid or exceeds safe resource limits.");
            }
            destPath = normalizedImageOutputPath(destPath, decoded.mimeType);
            const saved = await materializeMediaArtifact({
                filePath: destPath,
                validateExisting: async (candidate: string) => await validateDecodedImageFile(candidate, decoded.mimeType),
                producer: async () => bytes,
            });
            return { ok: true, path: saved.path };
        }
        const saved = await materializeMediaArtifact({
            filePath: destPath,
            ...(validateExisting ? { validateExisting } : {}),
            producerTimeoutMs: MEDIA_FETCH_TIMEOUT_MS,
            producer: async (signal?: AbortSignal) => {
                const res = await fetchPublicUrl(safeUrl, {
                    headers: { "User-Agent": "StellaDesktop/1.0" },
                        signal,
                });
                if (!res.ok) {
                    throw new Error(`Download failed (${res.status})`);
                }
                const bytes = await readResponseBodyBounded(res, { signal });
                const responseIsImage = res.headers
                    .get("content-type")
                    ?.toLowerCase()
                    .startsWith("image/") ?? false;
                if (declaredImage || responseIsImage) {
                    const decoded = await decodeAndValidateImage(bytes);
                    if (!decoded)
                        throw new Error("Downloaded image is invalid or exceeds safe resource limits.");
                    if (expectedImageMime && decoded.mimeType !== expectedImageMime) {
                        throw new Error(`Downloaded image bytes are ${decoded.mimeType}, not ${expectedImageMime}.`);
                    }
                    if (!expectedImageMime) {
                        throw new Error("Image output requires an extension matching its decoded bytes.");
                    }
                }
                return bytes;
            },
        });
        return { ok: true, path: saved.path };
    }
    catch (error) {
        return { ok: false, error: error instanceof Error ? error.message : String(error) };
    }
};
