import { useChatStorageMode } from "@/features/chat/services/chat-storage-preference";
import { useEffect, useMemo, useState } from "react";
import type { DeviceDestination } from "@stella/contracts/turn-plane/placement";
import { useExecutionDeviceList } from "@/features/cloud/use-execution-device-list";
import { backendUrl } from "@/platform/backend/backend-client";
import { useCloudConversationSession } from "@/global/auth/hooks/use-cloud-conversation-session";
import { useAuthSessionState } from "@/global/auth/hooks/use-auth-session-state";
import { AUTOMATIC_EXECUTION_TARGET, executionTargetStore, useExecutionTarget, type DesktopExecutionTarget } from "@/features/execution-placement/execution-target-store";
import { executionDeviceBlocker, isExecutionDeviceSelectable, type DeviceExecutionBlocker } from "@/features/execution-placement/device-remote-execution";
import { openConnectDialog } from "@/global/integrations/connect-action";
import { getDeviceIdOrNull } from "@/platform/electron/device";
import { platformCapabilities } from "@/platform/capabilities";
import { SIGN_IN_TOAST_ACTION } from "@/shared/lib/auth-cta";
import { useUiState } from "@/context/ui-state";
import { showToast } from "@/ui/toast";
import { conversationBrainAvailable, useConversationBrain } from "@/features/execution-placement/conversation-brain";
import { Icons, type IconData } from "../kit";
import { fontSize, look, mix, radius, useTokens, derive } from "../theme";
import { GroupIcon, Panel, TopbarButton } from "./topbar/chrome";

const BLOCKER_LABELS: Record<DeviceExecutionBlocker, string> = {
  offline: "Offline",
  notEnabled: "Not enabled",
  asking: "Waiting for approval",
  declined: "Declined",
  notReady: "Not ready",
};

const TRIGGER_LABEL = "Where Stella works";

const moveErrorMessage = (error: unknown): string =>
  (error instanceof Error ? error.message : String(error)).replace(/^Error invoking remote method '[^']*': (?:\w*Error: )?/u, "");

const OPTION_TEXT = look(16, 400, { lh: 1.5, em: 0 });
const OPTION_SMALL = look(fontSize.xs, 400);

/** `.execution-target-option`: icon, label, then a check or a small note. */
function TargetOption({ id, icon, label, trailing, disabled, onPress }: { id: string; icon: IconData; label: string; trailing?: { check: true } | { note: string }; disabled?: boolean; onPress: () => void }) {
  const t = useTokens();
  const hover = derive(t, "exec-target:hover", (t) => mix(t.c.foreground, 6, "transparent"));
  const color = disabled ? t.c.textWeak : t.c.textBase;
  return (
    <row id={id} role="menuitem" focusable={!disabled} disabled={disabled} w="full" minH={36} px={9} py={7} gap={9} align="center" radius={radius.md} hover={disabled ? undefined : hover} opacity={disabled ? 0.65 : undefined} onPress={disabled ? undefined : onPress}>
      <box w={18} align="start">
        <GroupIcon icon={icon} size={16} color={color} />
      </box>
      <text {...OPTION_TEXT} color={color} grow={1} shrink minW={0} truncate>{label}</text>
      {trailing ? "check" in trailing ? <GroupIcon icon={Icons.stella.Check} size={15} color={color} /> : <text {...OPTION_SMALL} color={t.c.textWeak}>{trailing.note}</text> : <box />}
    </row>
  );
}

/** desktop-ui's `GlobalExecutionTargetControl`: where Stella works (this computer, cloud, another computer). */
export function GlobalExecutionTargetControl() {
  const isPrivate = useChatStorageMode() === "local";
  const strong = useTokens().c.textStrong;
  const { isCloudConversationReady: authCloudReady } = useCloudConversationSession();
  const isCloudConversationReady = !isPrivate && authCloudReady;
  const { hasConnectedAccount } = useAuthSessionState();
  const [open, setOpen] = useState(false);
  const [currentDeviceId, setCurrentDeviceId] = useState<string | null>(null);
  const storedTarget = useExecutionTarget();
  const movesBrain = conversationBrainAvailable();
  const { state: uiState } = useUiState();
  const brainConversationId = movesBrain && isCloudConversationReady && hasConnectedAccount ? uiState.conversationId : null;
  const { brain, moving, move } = useConversationBrain(brainConversationId);
  const brainTarget: DesktopExecutionTarget = !brain || brain.here ? AUTOMATIC_EXECUTION_TARGET : brain.target;
  const target = !hasConnectedAccount ? AUTOMATIC_EXECUTION_TARGET : movesBrain ? brainTarget : storedTarget;
  const httpOrigin = isCloudConversationReady && hasConnectedAccount && backendUrl ? backendUrl : null;
  const [destinations, setDestinations] = useState<DeviceDestination[] | undefined>(undefined);

  useExecutionDeviceList({
    httpOrigin: open && isCloudConversationReady && hasConnectedAccount ? httpOrigin : null,
    onDevices: (devices) => setDestinations(devices),
  });

  useEffect(() => {
    void getDeviceIdOrNull().then(setCurrentDeviceId, () => setCurrentDeviceId(null));
  }, []);

  const otherDevices = useMemo(
    () => (destinations ?? []).filter((device) => device.deviceId !== currentDeviceId && (device.online || (target.mode === "device" && target.deviceId === device.deviceId))),
    [currentDeviceId, destinations, target],
  );
  const hasDeviceToEnable = otherDevices.some((device) => !device.remoteExecutionEnabled);

  const choose = (next: DesktopExecutionTarget) => {
    setOpen(false);
    if (!movesBrain) {
      executionTargetStore.set(next);
      return;
    }
    if (!brainConversationId) return;
    void move(next).catch((error: unknown) => {
      showToast({ title: "Stella couldn't move", description: moveErrorMessage(error), variant: "error" });
    });
  };

  if (isPrivate) return null;

  return (
    <>
      <TopbarButton id="execution-target-button" label={TRIGGER_LABEL} title={TRIGGER_LABEL} active={open} onPress={() => setOpen(!open)}>
        {(color) => <GroupIcon icon={target.mode === "cloud" ? Icons.stella.Globe : Icons.stella.Monitor} size={18} strokeWidth={1.5} color={color} hoverColor={strong} opacity={moving ? 0.6 : 1} />}
      </TopbarButton>
      <Panel id="execution-target-popover" anchor="execution-target-button" open={open} onClose={() => setOpen(false)} w={280} label={TRIGGER_LABEL}>
        <col w="full" gap={2} pad={12} focusGroup>
          <TargetOption id="execution-target-automatic" icon={platformCapabilities.website ? Icons.stella.Globe : Icons.stella.Monitor} label={platformCapabilities.automaticExecutionLabel} trailing={target.mode === "automatic" ? { check: true } : undefined} onPress={() => choose({ mode: "automatic" })} />
          <TargetOption
            id="execution-target-cloud"
            icon={Icons.stella.Globe}
            label="Cloud"
            trailing={!hasConnectedAccount ? { note: "Sign in" } : target.mode === "cloud" ? { check: true } : undefined}
            onPress={() => {
              if (hasConnectedAccount) {
                choose({ mode: "cloud" });
                return;
              }
              setOpen(false);
              SIGN_IN_TOAST_ACTION.onClick();
            }}
          />
          {otherDevices.map((device) => {
            const blocker = executionDeviceBlocker(device);
            return (
              <TargetOption
                key={device.deviceId}
                id={`execution-target-${device.deviceId}`}
                icon={Icons.stella.Monitor}
                label={device.label ?? "Computer"}
                disabled={!isExecutionDeviceSelectable(device)}
                trailing={blocker ? { note: BLOCKER_LABELS[blocker] } : target.mode === "device" && target.deviceId === device.deviceId ? { check: true } : undefined}
                onPress={() => choose({ mode: "device", deviceId: device.deviceId })}
              />
            );
          })}
          {hasConnectedAccount && hasDeviceToEnable ? (
            <TargetOption
              id="execution-target-enable"
              icon={Icons.stella.Monitor}
              label="Enable a computer…"
              onPress={() => {
                setOpen(false);
                openConnectDialog();
              }}
            />
          ) : null}
        </col>
      </Panel>
    </>
  );
}
