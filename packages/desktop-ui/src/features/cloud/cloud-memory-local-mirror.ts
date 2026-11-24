let mirrorQueue: Promise<boolean> = Promise.resolve(true);

const enqueue = (task: () => Promise<boolean>): Promise<boolean> => {
  mirrorQueue = mirrorQueue.catch(() => false).then(task);
  return mirrorQueue;
};

const writeLocal = async (patch: {
  memoryEnabled: boolean;
  memoryChoice?: boolean;
}): Promise<boolean> => {
  const api = window.electronAPI?.system?.setLocalModelPreferences;
  if (!api) return true;
  const result = await api(patch);
  return result?.memoryEnabled === patch.memoryEnabled;
};

export const mirrorCloudMemoryPreferenceLocally = (
  memoryEnabled: boolean,
  options: { settled?: boolean } = {},
): Promise<boolean> =>
  enqueue(() =>
    writeLocal(
      options.settled ? { memoryEnabled, memoryChoice: memoryEnabled } : { memoryEnabled },
    ),
  );

export const restoreLocalMemoryChoice = (
  options: { whenUnknown?: "on" | "keep" } = {},
): Promise<boolean> =>
  enqueue(async () => {
    const system = window.electronAPI?.system;
    if (!system?.getLocalModelPreferences) return true;
    const preferences = await system.getLocalModelPreferences();
    if (!preferences) return false;
    if (preferences.memoryChoice == null && options.whenUnknown === "keep") {
      return true;
    }
    const memoryEnabled = preferences.memoryChoice ?? true;
    if (preferences.memoryEnabled === memoryEnabled) return true;
    return await writeLocal({ memoryEnabled });
  });

export const setLocalMemoryChoice = (memoryEnabled: boolean): Promise<boolean> =>
  enqueue(() => writeLocal({ memoryEnabled, memoryChoice: memoryEnabled }));
