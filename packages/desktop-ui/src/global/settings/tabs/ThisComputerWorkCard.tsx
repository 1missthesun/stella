import { useExecutionDevicesController } from "@/global/settings/hooks/use-execution-devices-controller";
import { useT } from "@/shared/i18n";
import { SettingsToggleCard } from "./settings-toggle-card";

/** Whether Stella on the user's other devices may start tasks on this computer. */
export function ThisComputerWorkCard() {
  const t = useT();
  const { devices, currentDeviceId, error, pendingDeviceId, setRemoteExecution } =
    useExecutionDevicesController();
  const self = devices?.find((device) => device.deviceId === currentDeviceId);
  return (
    <SettingsToggleCard
      titleKey="settings.thisComputerWork.title"
      description={t("settings.thisComputerWork.description")}
      error={
        error === "update"
          ? t("settings.executionDevices.errors.update")
          : error === "load"
            ? t("settings.executionDevices.errors.load")
            : null
      }
      checked={self?.remoteExecutionEnabled === true}
      disabled={!self || pendingDeviceId !== null}
      onChange={(checked) => {
        if (self) void setRemoteExecution(self.deviceId, checked);
      }}
    />
  );
}
