/** Never let a bearer-bearing path reach structured request logs. */
export const previewSafeRequestLogPath = (pathname: string): string =>
  pathname.startsWith("/internal/previews/")
    ? "/internal/previews/:session/:capability"
    : pathname;
