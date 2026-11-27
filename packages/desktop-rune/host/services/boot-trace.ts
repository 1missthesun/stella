// STELLA_RUNE_BOOT_TRACE=1 logs boot milestones as `[mark] <label> <ms since process start> <rss MB>`.

const enabled = process.env.STELLA_RUNE_BOOT_TRACE === "1";

export const bootMark = (label: string) => {
  if (enabled) console.error(`[mark] ${label} ${performance.now().toFixed(1)} ${(process.memoryUsage.rss() / 1048576).toFixed(0)}`);
};
