/**
 * Lets the service learn which Chrome profile a connection belongs to: it has
 * the marker stored, then looks for it in the profiles' storage on disk.
 */
const STORAGE_KEY = "stella_profile_mark";

export async function handleProfileMark({ id, marker }) {
  if (!marker) throw new Error("marker is required for profile_mark");
  await chrome.storage.local.set({ [STORAGE_KEY]: marker });
  return { id, success: true, data: {} };
}

export async function handleProfileUnmark({ id }) {
  await chrome.storage.local.remove(STORAGE_KEY);
  return { id, success: true, data: {} };
}
