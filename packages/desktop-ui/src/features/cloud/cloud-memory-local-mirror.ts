let mirrorQueue: Promise<boolean> = Promise.resolve(true);

export const mirrorCloudMemoryPreferenceLocally = (
  memoryEnabled: boolean,
): Promise<boolean> => {
  mirrorQueue = mirrorQueue
    .catch(() => false)
    .then(async () => {
      const api = window.electronAPI?.system?.setLocalModelPreferences;
      if (!api) return true;
      const result = await api({ memoryEnabled });
      return result?.memoryEnabled === memoryEnabled;
    });
  return mirrorQueue;
};

