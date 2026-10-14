export const backendUrl = (
  (import.meta.env.VITE_STELLA_BACKEND_URL as string | undefined) ?? ""
)
  .trim()
  .replace(/\/+$/, "");

export const requireBackendUrl = (): string => {
  if (!backendUrl) throw new Error("VITE_STELLA_BACKEND_URL is not set.");
  return backendUrl;
};
