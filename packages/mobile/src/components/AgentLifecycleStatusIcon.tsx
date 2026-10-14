import type { TaskLifecycleStatus } from "@stella/contracts/agent-runtime";
import { Icon, type IconName } from "./Icon";

export const AGENT_LIFECYCLE_STATUS_ICONS = {
  running: "circle-dot",
  completed: "check-circle",
  error: "alert-circle",
  canceled: "circle",
} as const satisfies Record<TaskLifecycleStatus, IconName>;

export function AgentLifecycleStatusIcon({
  status,
  size,
  color,
}: {
  status: TaskLifecycleStatus;
  size: number;
  color: string;
}) {
  return (
    <Icon
      name={AGENT_LIFECYCLE_STATUS_ICONS[status]}
      size={size}
      color={color}
    />
  );
}
