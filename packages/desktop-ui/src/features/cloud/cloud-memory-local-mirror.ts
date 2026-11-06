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

/**
 * Mirrors the account's Memory setting onto this computer. A settled account
 * value is also remembered as the user's choice for when they are signed out.
 */
export const mirrorCloudMemoryPreferenceLocally = (
  memoryEnabled: boolean,
  options: { settled?: boolean } = {},
): Promise<boolean> =>
  enqueue(() =>
    writeLocal(
      options.settled ? { memoryEnabled, memoryChoice: memoryEnabled } : { memoryEnabled },
    ),
  );

/**
 * Memory follows the user's last settled choice while the account value is
 * unknown (signed out, offline, or still loading). With no choice yet it is on
 * when signed out, and left as it is when signed in.
 */
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
