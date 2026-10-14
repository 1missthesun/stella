import { useChatStorageMode } from "@/features/chat/services/chat-storage-preference";
import { useEffect, useMemo, useState } from "react";
import type { DeviceDestination } from "@stella/contracts/turn-plane/placement";
import { useExecutionDeviceList } from "@/features/cloud/use-execution-device-list";
import { backendUrl } from "@/platform/backend/backend-client";
import { useCloudConversationSession } from "@/global/auth/hooks/use-cloud-conversation-session";
import { useAuthSessionState } from "@/global/auth/hooks/use-auth-session-state";
import {
  AUTOMATIC_EXECUTION_TARGET,
  executionTargetStore,
  useExecutionTarget,
  type DesktopExecutionTarget,
} from "@/features/execution-placement/execution-target-store";
import {
  executionDeviceBlocker,
  isExecutionDeviceSelectable,
  type DeviceExecutionBlocker,
} from "@/features/execution-placement/device-remote-execution";
import { openConnectDialog } from "@/global/integrations/connect-action";
import { getDeviceIdOrNull } from "@/platform/electron/device";
import {
  Popover,
  PopoverBody,
  PopoverContent,
  PopoverTrigger,
} from "@/ui/popover";
import { AppWindowMac, Check, Globe } from "@/ui/icons";
import { platformCapabilities } from "@/platform/capabilities";
import { SIGN_IN_TOAST_ACTION } from "@/shared/lib/auth-cta";
import { useUiState } from "@/context/ui-state";
import { showToast } from "@/ui/toast";
import {
  conversationBrainAvailable,
  useConversationBrain,
} from "@/features/execution-placement/conversation-brain";

const BLOCKER_LABELS: Record<DeviceExecutionBlocker, string> = {
  offline: "Offline",
  notEnabled: "Not enabled",
  asking: "Waiting for approval",
  declined: "Declined",
  notReady: "Not ready",
};

const moveErrorMessage = (error: unknown): string =>
  (error instanceof Error ? error.message : String(error)).replace(
    /^Error invoking remote method '[^']*': (?:\w*Error: )?/u,
    "",
  );

export function GlobalExecutionTargetControl() {
  const isPrivate = useChatStorageMode() === "local";
  const { isCloudConversationReady: authCloudReady } = useCloudConversationSession();
  const isCloudConversationReady = !isPrivate && authCloudReady;
  const { hasConnectedAccount } = useAuthSessionState();
  const [open, setOpen] = useState(false);
  const [currentDeviceId, setCurrentDeviceId] = useState<string | null>(null);
  const storedTarget = useExecutionTarget();
  const movesBrain = conversationBrainAvailable();
  const { state: uiState } = useUiState();
  const brainConversationId =
    movesBrain && isCloudConversationReady && hasConnectedAccount
      ? uiState.conversationId
      : null;
  const { brain, moving, move } = useConversationBrain(brainConversationId);
  const brainTarget: DesktopExecutionTarget =
    !brain || brain.here ? AUTOMATIC_EXECUTION_TARGET : brain.target;
  const target = !hasConnectedAccount
    ? AUTOMATIC_EXECUTION_TARGET
    : movesBrain
      ? brainTarget
      : storedTarget;
  const socketOrigin =
    isCloudConversationReady && hasConnectedAccount && backendUrl
      ? backendUrl
      : null;
  const [destinations, setDestinations] = useState<
    DeviceDestination[] | undefined
  >(undefined);

  useExecutionDeviceList({
    socketOrigin:
      open && isCloudConversationReady && hasConnectedAccount
        ? socketOrigin
        : null,
    onDevices: (devices) => setDestinations(devices),
  });

  useEffect(() => {
    void getDeviceIdOrNull().then(setCurrentDeviceId, () =>
      setCurrentDeviceId(null),
    );
  }, []);

  const otherDevices = useMemo(
    () =>
      (destinations ?? []).filter(
        (device) =>
          device.deviceId !== currentDeviceId &&
          (device.online ||
            (target.mode === "device" && target.deviceId === device.deviceId)),
      ),
    [currentDeviceId, destinations, target],
  );
  const hasDeviceToEnable = otherDevices.some(
    (device) => !device.remoteExecutionEnabled,
  );
  const selectedDevice =
    target.mode === "device"
      ? destinations?.find((device) => device.deviceId === target.deviceId)
      : undefined;

  const label =
    target.mode === "cloud"
      ? "Cloud"
      : target.mode === "device"
        ? (selectedDevice?.label ??
          (brain && !brain.here ? brain.label : undefined) ??
          "Computer")
        : platformCapabilities.automaticExecutionLabel;
  const TriggerIcon = target.mode === "cloud" ? Globe : AppWindowMac;

  const choose = (next: DesktopExecutionTarget) => {
    setOpen(false);
    if (!movesBrain) {
      executionTargetStore.set(next);
      return;
    }
    if (!brainConversationId) return;
    void move(next).catch((error: unknown) => {
      showToast({
        title: "Stella couldn't move",
        description: moveErrorMessage(error),
        variant: "error",
      });
    });
  };

  if (isPrivate) return null;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          className="sidebar-footer-button execution-target-button"
          data-active={open || undefined}
          aria-busy={moving || undefined}
          aria-label={`Run on ${label}`}
          aria-pressed={open}
        >
          <TriggerIcon size={14} strokeWidth={1.75} />
          <span>{label}</span>
        </button>
      </PopoverTrigger>
      <PopoverContent
        className="execution-target-popover"
        side="top"
        align="end"
        sideOffset={8}
        collisionPadding={8}
      >
        <PopoverBody className="execution-target-list">
          <button
            type="button"
            className="execution-target-option"
            onClick={() => choose({ mode: "automatic" })}
          >
            {platformCapabilities.website ? (
              <Globe size={16} />
            ) : (
              <AppWindowMac size={16} />
            )}
            <span>{platformCapabilities.automaticExecutionLabel}</span>
            {target.mode === "automatic" ? <Check size={15} /> : null}
          </button>
          <button
            type="button"
            className="execution-target-option"
            onClick={() => {
              if (hasConnectedAccount) {
                choose({ mode: "cloud" });
                return;
              }
              setOpen(false);
              SIGN_IN_TOAST_ACTION.onClick();
            }}
          >
            <Globe size={16} />
            <span>Cloud</span>
            {!hasConnectedAccount ? (
              <small>Sign in</small>
            ) : target.mode === "cloud" ? (
              <Check size={15} />
            ) : null}
          </button>
          {otherDevices.map((device) => {
            const blocker = executionDeviceBlocker(device);
            const selectable = isExecutionDeviceSelectable(device);
            return (
              <button
                key={device.deviceId}
                type="button"
                className="execution-target-option"
                disabled={!selectable}
                onClick={() =>
                  choose({ mode: "device", deviceId: device.deviceId })
                }
              >
                <AppWindowMac size={16} />
                <span>{device.label ?? "Computer"}</span>
                {blocker ? (
                  <small>{BLOCKER_LABELS[blocker]}</small>
                ) : target.mode === "device" &&
                  target.deviceId === device.deviceId ? (
                  <Check size={15} />
                ) : null}
              </button>
            );
          })}
          {hasConnectedAccount && hasDeviceToEnable ? (
            <button
              type="button"
              className="execution-target-option"
              onClick={() => {
                setOpen(false);
                openConnectDialog();
              }}
            >
              <AppWindowMac size={16} />
              <span>Enable a computer…</span>
            </button>
          ) : null}
        </PopoverBody>
      </PopoverContent>
    </Popover>
  );
}
