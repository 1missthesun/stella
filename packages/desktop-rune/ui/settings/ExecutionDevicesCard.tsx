import { Switch, T, tx } from "../kit/compat";
import { useConnectDialog } from "../global/integrations/ConnectDialog.styles";
import type { DeviceRemoteExecution } from "@stella/contracts/turn-plane/placement";
import {
  useExecutionDevicesController,
  type ExecutionDeviceRow,
} from "@/global/settings/hooks/use-execution-devices-controller";
import { useT } from "@/shared/i18n";

const CONSENT_KEYS: Record<DeviceRemoteExecution, string> = {
  enabled: "settings.executionDevices.state.enabled",
  unconfigured: "settings.executionDevices.state.notEnabled",
  asking: "settings.executionDevices.state.asking",
  declined: "settings.executionDevices.state.declined",
};

export function ExecutionDevicesCard() {
  const s = useConnectDialog();
  const t = useT();
  const { devices, error, pendingDeviceId, setRemoteExecution } =
    useExecutionDevicesController();

  if (devices === null) {
    return error === "load" ? (
      <T w="full" {...s.connectNote} {...s.connectNoteError}>
        {t("settings.executionDevices.errors.load")}
      </T>
    ) : (
      <col w="full" {...s.connectList} {...s.connectListLoading} aria-busy="true" />
    );
  }

  if (devices.length === 0) {
    return (
      <T w="full" {...s.connectNote}>{t("settings.executionDevices.empty")}</T>
    );
  }

  const label = (device: ExecutionDeviceRow) =>
    device.label?.trim().replace(/\.local$/i, "") ||
    t("settings.executionDevices.unnamed");

  return (
    <>
      <col w="full" {...s.connectList}>
        {devices.map((device) => (
          <row {...s.connectDevice} key={device.deviceId}>
            <row {...s.connectDeviceDot} /* VARIANT data-device-presence=device.online ? "online" : "offline": DevicePresenceOnline→s.connectDeviceDotDevicePresenceOnline */ />
            <col {...s.connectDeviceText}>
              <row {...s.connectDeviceName}>
                <T {...s.connectDeviceLabel}>{label(device)}</T>
                {device.isCurrent ? (
                  <T {...s.connectDeviceTag}>
                    {t("settings.executionDevices.thisComputer")}
                  </T>
                ) : null}
              </row>
              <T {...s.connectDeviceMeta}>
                {`${t(
                  device.online
                    ? "settings.executionDevices.online"
                    : "settings.executionDevices.offline",
                )} · ${t(CONSENT_KEYS[device.remoteExecution])}`}
              </T>
            </col>
            <Switch checked={device.remoteExecutionEnabled} disabled={pendingDeviceId !== null} data-device-action={
                device.remoteExecutionEnabled ? "disable" : "enable"
              } aria-label={label(device)} onCheckedChange={(next) =>
                void setRemoteExecution(device.deviceId, next)
              } />
          </row>
        ))}
      </col>
      {error === "update" ? (
        <T w="full" {...s.connectNote} {...s.connectNoteError}>
          {t("settings.executionDevices.errors.update")}
        </T>
      ) : null}
    </>
  );
}
