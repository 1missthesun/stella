/** Whether this UI runs as the phone app (packages/mobile-rune sets `stella.phone` before the UI loads). */
export const onPhone = (): boolean => Boolean((globalThis as { stella?: { phone?: unknown } }).stella?.phone);
