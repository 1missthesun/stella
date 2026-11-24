const settleSilently = (promise: Promise<unknown>): Promise<void> =>
  promise.then(
    () => undefined,
    () => undefined,
  );

export const joinWithTimeout = async (
  promise: Promise<unknown>,
  timeoutMs: number,
  onTimeout?: () => void,
): Promise<"joined" | "timeout"> => {
  let timer: ReturnType<typeof setTimeout> | null = null;
  try {
    const result = await Promise.race([
      settleSilently(promise).then(() => "joined" as const),
      new Promise<"timeout">((resolve) => {
        timer = setTimeout(() => resolve("timeout"), timeoutMs);
        timer.unref?.();
      }),
    ]);
    if (result === "timeout") onTimeout?.();
    return result;
  } finally {
    if (timer !== null) clearTimeout(timer);
  }
};
