export const getBillingReturnUrl = async (): Promise<string> => {
  let baseUrl = (import.meta.env.VITE_STELLA_WEB_URL as string | undefined)?.trim() || "https://stella.sh";
  try {
    const resolved = await window.electronAPI?.website?.getBaseUrl?.();
    if (resolved) baseUrl = resolved;
  } catch {}
  return new URL("/billing", baseUrl).toString();
};
