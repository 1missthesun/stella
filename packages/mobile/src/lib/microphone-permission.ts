import { AudioModule } from "expo-audio";

export type MicrophonePermissionResult =
  | { granted: true }
  | { granted: false; canAskAgain: boolean };

type PermissionLike = { granted?: boolean; canAskAgain?: boolean };

const normalize = (value: PermissionLike | null | undefined) =>
  value?.granted === true
    ? ({ granted: true } as const)
    : ({ granted: false, canAskAgain: value?.canAskAgain !== false } as const);

export const ensureMicrophonePermission =
  async (): Promise<MicrophonePermissionResult> => {
    const current = normalize(
      await AudioModule.getRecordingPermissionsAsync().catch(() => null),
    );
    if (current.granted) return current;
    if (!current.canAskAgain) return current;
    return normalize(await AudioModule.requestRecordingPermissionsAsync());
  };
