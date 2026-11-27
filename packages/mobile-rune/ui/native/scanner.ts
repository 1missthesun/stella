// The camera's QR scanner (ios/StellaRune/Scanner.swift, android Scanner.kt): the text of the
// first QR code it reads, or null when the person closes it. Fails with `PhoneRequestError`
// codes `denied` (no camera access) or `unavailable` (no camera, or the scanner can't run).
import { isPhoneApp, phoneRequest } from "./app";

export const scanQrCode = (hint: string): Promise<string | null> =>
  isPhoneApp() ? phoneRequest<string | null>("scanner.scan", { hint }) : Promise.resolve(null);
