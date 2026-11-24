export type ConnectPlanReason = "allowance" | "allowance-near" | "no-engine";

export type ConnectPlanNoticeState = {
  reason: ConnectPlanReason;
  resend?: () => void;
  choose?: boolean;
};
