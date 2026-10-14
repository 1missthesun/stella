export const SEND_FOLLOW_THRESHOLD_PX = 300;

export const AT_BOTTOM_TOLERANCE_PX = 200;

export const shouldFollowSend = ({
  distanceFromBottomPx,
  isFollowingLatest,
}: {
  distanceFromBottomPx: number;
  isFollowingLatest: boolean;
}): boolean =>
  isFollowingLatest && distanceFromBottomPx <= SEND_FOLLOW_THRESHOLD_PX;
