/**
 * Why the connect-your-plan card is showing:
 * - `allowance`: the Free account's usage of Stella's own models ran out.
 * - `allowance-near`: the one-time heads-up at about 80% used.
 * - `no-engine`: nothing can answer yet (no Stella account, no plan, no key).
 */
export type ConnectPlanReason = "allowance" | "allowance-near" | "no-engine";

export type ConnectPlanNoticeState = {
  reason: ConnectPlanReason;
  /**
   * Runs once a plan is connected and Stella has switched to it, e.g. to
   * send the message that didn't go through. Without it, the `allowance`
   * card resends the conversation's last message of the person's own.
   */
  resend?: () => void;
  /** Open on the list of plans instead of the offer. */
  choose?: boolean;
};
