import {
  EMPTY_SECRET_FINGERPRINTS,
  redactSecretFingerprints,
  redactSecretFingerprintsDeep,
  type SecretFingerprints,
} from "@stella/contracts/secret-redaction";

type FingerprintSource = () => Promise<unknown>;

const MAX_AGE_MS = 2_000;

let source: FingerprintSource | null = null;
let cached: { at: number; fingerprints: SecretFingerprints } = {
  at: 0,
  fingerprints: EMPTY_SECRET_FINGERPRINTS,
};
let inflight: Promise<SecretFingerprints> | null = null;

const isFiniteInteger = (value: unknown): value is number =>
  typeof value === "number" && Number.isSafeInteger(value) && value > 0;

const parseFingerprints = (value: unknown): SecretFingerprints | null => {
  const candidate = value as Partial<SecretFingerprints> | null;
  if (
    !candidate ||
    !isFiniteInteger(candidate.baseA) ||
    !isFiniteInteger(candidate.baseB) ||
    !Array.isArray(candidate.windows)
  ) {
    return null;
  }
  const windows: { length: number; hashes: number[]; exact?: boolean }[] = [];
  for (const window of candidate.windows) {
    if (!isFiniteInteger(window?.length) || !Array.isArray(window.hashes)) {
      return null;
    }
    windows.push({
      length: window.length,
      hashes: (window.hashes as unknown[]).filter((hash): hash is number =>
        Number.isSafeInteger(hash),
      ),
      ...(window.exact === true ? { exact: true } : {}),
    });
  }
  return { baseA: candidate.baseA, baseB: candidate.baseB, windows };
};

export const setSecureValueFingerprintSource = (
  next: FingerprintSource | null,
): void => {
  source = next;
  inflight = null;
  cached = { at: 0, fingerprints: EMPTY_SECRET_FINGERPRINTS };
};

export const invalidateSecureValueFingerprints = (): void => {
  cached = { ...cached, at: 0 };
};

export const currentSecureValueFingerprints =
  async (): Promise<SecretFingerprints> => {
    const read = source;
    if (!read) return EMPTY_SECRET_FINGERPRINTS;
    if (Date.now() - cached.at < MAX_AGE_MS) return cached.fingerprints;
    if (!inflight) {
      const pending = read()
        .then((value) => {
          const fingerprints = parseFingerprints(value) ?? cached.fingerprints;
          cached = { at: Date.now(), fingerprints };
          return fingerprints;
        })
        .catch(() => cached.fingerprints)
        .finally(() => {
          if (inflight === pending) inflight = null;
        });
      inflight = pending;
    }
    return await inflight;
  };

export const redactSecureValues = async <T>(value: T): Promise<T> =>
  redactSecretFingerprintsDeep(value, await currentSecureValueFingerprints());

export const redactSecureValuesInText = async (text: string): Promise<string> =>
  redactSecretFingerprints(text, await currentSecureValueFingerprints());
