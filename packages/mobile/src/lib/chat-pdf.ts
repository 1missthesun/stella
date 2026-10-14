import type { MobileDisplayPayload } from "../types";

type PdfPayload = Extract<MobileDisplayPayload, { kind: "pdf" }>;

export type PdfShareOutcome = { ok: true } | { ok: false; error: string };

export async function sharePdf(payload: PdfPayload): Promise<PdfShareOutcome> {
  const localUri = payload.localUri;
  if (!localUri) {
    return { ok: false, error: "This PDF isn't available on the device." };
  }
  try {
    const Sharing = await import("expo-sharing");
    if (!(await Sharing.isAvailableAsync())) {
      return { ok: false, error: "Sharing isn't available on this device." };
    }
    await Sharing.shareAsync(localUri, {
      mimeType: "application/pdf",
      UTI: "com.adobe.pdf",
      dialogTitle: payload.title ?? payload.filePath,
    });
    return { ok: true };
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "unexpected error";
    return { ok: false, error: `Couldn't share the PDF: ${message}` };
  }
}
