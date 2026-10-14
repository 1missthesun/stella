export const readBackendUrl = (): string | null =>
  process.env.NEXT_PUBLIC_STELLA_BACKEND_URL?.trim().replace(/\/+$/, "") || null;

export const isBackendConfigured = (): boolean => readBackendUrl() !== null;
