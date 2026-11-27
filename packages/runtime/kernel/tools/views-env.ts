/** Whether this host draws Stella Views (the Rune desktop does; Electron doesn't). Agent shells see it as STELLA_VIEWS=1. */
export const hostRendersViews = (): boolean =>
  process.env.STELLA_VIEWS === "1" || (process.env.STELLA_VIEWS !== "0" && process.env.STELLA_LAUNCHER_ENGINE === "rune");
