let reported = false;

export function reportFirstAppPaint(): void {
  if (reported || typeof window === "undefined") return;
  reported = true;
  window.requestAnimationFrame(() => {
    window.setTimeout(() => {
      window.electronAPI?.system?.reportTiming?.({
        phase: "app.first-paint",
        elapsedMs: performance.now(),
      });
    }, 0);
  });
}
