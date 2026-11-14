import {
  isActivityTaskWorking,
  type TaskItem,
} from "@/features/chat/lib/event-transforms";
import { TextShimmer } from "@/app/chat/TextShimmer";

type ShimmerTask = Pick<
  TaskItem,
  "status" | "waitingFor" | "waitingForHelpers" | "paused" | "helpersWorking"
>;

export const isTopLevelActivityShimmerEligible = (
  task: ShimmerTask,
  isTopLevel: boolean,
): boolean => isTopLevel && isActivityTaskWorking(task);

export function ActivityTaskShimmer({
  task,
  text,
  isTopLevel,
}: {
  task: ShimmerTask;
  text: string;
  isTopLevel: boolean;
}) {
  if (!isTopLevelActivityShimmerEligible(task, isTopLevel)) return text;
  return (
    <TextShimmer
      text={text}
      durationMs={2000}
      className="activity-task-shimmer"
    />
  );
}
