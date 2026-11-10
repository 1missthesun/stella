import { execFile } from "node:child_process";
import {
  app,
  nativeImage,
  type BrowserWindow,
  type IpcMainEvent,
  type IpcMainInvokeEvent,
} from "electron";
import {
  IPC_APP_SET_UNREAD_BADGE,
  IPC_PREFERENCES_GET_MESSAGE_SOUND,
  IPC_PREFERENCES_SET_MESSAGE_SOUND,
  IPC_SYSTEM_IS_QUIET,
} from "@stella/contracts/desktop/ipc-channels";
import {
  DEFAULT_MESSAGE_SOUND,
  normalizeMessageSound,
  type MessageSoundPreferences,
  type UnreadBadge,
} from "@stella/contracts/message-sound";
import {
  getMessageSoundPreferences,
  updateLocalPreferences,
} from "@stella/runtime/kernel/preferences/local-preferences";
import {
  isWithinQuietHours,
  type UserAskEscalationPolicy,
} from "@stella/contracts/user-ask";
import { minuteOfDayAt } from "../services/user-ask-escalation.js";
import { registerPrivilegedHandle, onPrivilegedIpc } from "./privileged-ipc.js";

export type ChatAlertHandlersOptions = {
  getStellaDataDir: () => string | null;
  getFullWindow: () => BrowserWindow | null;
  getUserAskPolicy: () => Promise<UserAskEscalationPolicy>;
  assertPrivilegedSender: (
    event: IpcMainEvent | IpcMainInvokeEvent,
    channel: string,
  ) => boolean;
};

const MAX_BADGE_COUNT = 999;
const QUIET_PROBE_TIMEOUT_MS = 1_000;

const probe = (command: string, args: string[]): Promise<string | null> =>
  new Promise((resolve) => {
    execFile(command, args, { timeout: QUIET_PROBE_TIMEOUT_MS }, (error, stdout) => {
      resolve(error ? null : String(stdout));
    });
  });

const linuxIsQuiet = async (): Promise<boolean> => {
  const [makoMode, gnomeBanners] = await Promise.all([
    probe("makoctl", ["mode"]),
    probe("gsettings", ["get", "org.gnome.desktop.notifications", "show-banners"]),
  ]);
  if (makoMode && /do-not-disturb|dnd/i.test(makoMode)) return true;
  return gnomeBanners?.trim() === "false";
};

const isSystemQuiet = async (): Promise<boolean> =>
  process.platform === "linux" ? await linuxIsQuiet() : false;

const isInStellaQuietHours = async (
  getPolicy: () => Promise<UserAskEscalationPolicy>,
): Promise<boolean> => {
  const policy = await getPolicy().catch(() => null);
  return policy
    ? isWithinQuietHours(policy.quietHours, minuteOfDayAt(Date.now(), policy.timeZone))
    : false;
};

const badgeLabel = (count: number) =>
  count > 99 ? "99+" : String(count);

const applyUnreadBadge = (badge: UnreadBadge, window: BrowserWindow | null) => {
  const count = Math.max(0, Math.min(MAX_BADGE_COUNT, Math.floor(Number(badge.count) || 0)));
  if (process.platform === "darwin") {
    app.dock?.setBadge(count > 0 ? badgeLabel(count) : "");
    return;
  }
  if (process.platform === "win32") {
    if (!window || window.isDestroyed()) return;
    const overlay =
      count > 0 && badge.overlayIconDataUrl?.startsWith("data:image/png;base64,")
        ? nativeImage.createFromDataURL(badge.overlayIconDataUrl)
        : null;
    window.setOverlayIcon(
      overlay && !overlay.isEmpty() ? overlay : null,
      count > 0 ? `${count} unread from Stella` : "",
    );
    return;
  }
  app.setBadgeCount(count);
};

export const registerChatAlertHandlers = (options: ChatAlertHandlersOptions) => {
  const readPreferences = (): MessageSoundPreferences => {
    const dataDir = options.getStellaDataDir();
    return dataDir
      ? getMessageSoundPreferences(dataDir)
      : { enabled: true, sound: DEFAULT_MESSAGE_SOUND };
  };

  registerPrivilegedHandle(options, IPC_PREFERENCES_GET_MESSAGE_SOUND, () => readPreferences());

  registerPrivilegedHandle(options, IPC_PREFERENCES_SET_MESSAGE_SOUND, (_event, patch) => {
    const current = readPreferences();
    const next: MessageSoundPreferences = {
      enabled: typeof patch?.enabled === "boolean" ? patch.enabled : current.enabled,
      sound: patch?.sound === undefined ? current.sound : normalizeMessageSound(patch.sound),
    };
    const dataDir = options.getStellaDataDir();
    if (dataDir) {
      updateLocalPreferences(dataDir, {
        messageSoundEnabled: next.enabled,
        ...(patch?.sound === undefined ? {} : { messageSoundChoice: next.sound }),
      });
    }
    return next;
  });

  registerPrivilegedHandle(options, IPC_SYSTEM_IS_QUIET, async () => {
    const [stellaQuiet, systemQuiet] = await Promise.all([
      isInStellaQuietHours(options.getUserAskPolicy),
      isSystemQuiet(),
    ]);
    return stellaQuiet || systemQuiet;
  });

  onPrivilegedIpc(options, IPC_APP_SET_UNREAD_BADGE, (_event, badge) => {
    applyUnreadBadge(badge, options.getFullWindow());
  });
};
