import {
  CONTAINER_TARIFF,
  TARIFF_VERSION,
  containerCostMicroCents,
  type CostEntry,
  type CostOutcome,
} from "@stella/contracts/billing-tariffs";
import type { StellaUsageLimit } from "@stella/contracts/stella-usage-limit";
import { INSTANCE_TIERS, type InstanceSize } from "./instance-size.js";

export const METER_TICK_MS = 60_000;
export const METER_SETTLE_EVERY_MS = 5 * 60_000;
const HOLD_MS = 15 * 60_000;
const MINIMUM_HOLD_MS = 2 * 60_000;
const HOLD_TTL_MS = 20 * 60_000;

// Running time and CPU of one container run, kept in its Sandbox object so a
// restart or eviction loses no time. `cpuUsec` is the VM's busy CPU counter
// at `settledThrough`; it is absent when it could not be read.
export type ContainerMeter = {
  owner: string;
  size: InstanceSize;
  run: string;
  startedAt: number;
  settledThrough: number;
  seq: number;
  cpuUsec?: number;
  lastSeenAt: number;
};

export const meterReservationId = (meter: Pick<ContainerMeter, "run">): string => `container:${meter.run}`;

const tier = (size: InstanceSize) => {
  const { memoryBytes, diskBytes, vCpu } = INSTANCE_TIERS[size];
  return { memoryGib: memoryBytes / 1024 ** 3, diskGb: diskBytes / 1000 ** 3, vcpu: vCpu };
};

// What to hold before (and while) a container runs: its provisioned size with
// every vCPU busy, so a CPU-heavy interval still fits the hold.
export const containerHold = (size: InstanceSize, now: number) => {
  const { memoryGib, diskGb, vcpu } = tier(size);
  const cost = (ms: number) =>
    containerCostMicroCents({ seconds: ms / 1000, memoryGib, diskGb, vcpu, activeVcpuSeconds: (ms / 1000) * vcpu });
  return {
    microCents: cost(HOLD_MS),
    minimumMicroCents: cost(MINIMUM_HOLD_MS),
    expiresAt: now + HOLD_TTL_MS,
    category: "container",
  };
};

export const meterInterval = (
  meter: ContainerMeter,
  until: number,
  cpuUsec: number | undefined,
  outcome: CostOutcome,
): { receiptId: string; chargeMicroCents: number; cost: CostEntry } => {
  const seconds = Math.max(0, (until - meter.settledThrough) / 1000);
  const { memoryGib, diskGb, vcpu } = tier(meter.size);
  const measured =
    cpuUsec !== undefined && meter.cpuUsec !== undefined
      ? Math.min(seconds * vcpu, Math.max(0, (cpuUsec >= meter.cpuUsec ? cpuUsec - meter.cpuUsec : cpuUsec) / 1e6))
      : undefined;
  const cpuSeconds = measured ?? seconds * vcpu * CONTAINER_TARIFF.estimatedCpuUtilization;
  const microCents = containerCostMicroCents({ seconds, memoryGib, diskGb, vcpu, activeVcpuSeconds: cpuSeconds });
  const receiptId = `${meterReservationId(meter)}:${meter.seq}`;
  return {
    receiptId,
    chargeMicroCents: microCents,
    cost: {
      id: receiptId,
      category: "container",
      provider: "cloudflare",
      sku: INSTANCE_TIERS[meter.size].instanceType,
      quantity: {
        seconds: Math.round(seconds * 1000) / 1000,
        memoryGib,
        diskGb,
        cpuSeconds: Math.round(cpuSeconds * 1000) / 1000,
      },
      providerCostMicroCents: microCents,
      basis: measured === undefined ? "estimated" : "actual",
      outcome,
      tariffVersion: TARIFF_VERSION,
    },
  };
};

// Busy CPU of the container's VM since boot, from the first line of
// /proc/stat (user nice system idle iowait irq softirq steal ...), in USER_HZ
// ticks of 10 ms. Steal is time the host took, not the container's use.
export const CPU_READ_COMMAND = ["head", "-n", "1", "/proc/stat"];

export const parseCpuUsec = (stdout: string): number | undefined => {
  const fields = stdout.trim().split(/\s+/u);
  if (fields[0] !== "cpu" || fields.length < 8) return undefined;
  const ticks = fields.slice(1, 8).map(Number);
  if (ticks.some((value) => !Number.isFinite(value) || value < 0)) return undefined;
  const [user, nice, system, , , irq, softirq] = ticks as [number, number, number, number, number, number, number];
  return (user + nice + system + irq + softirq) * 10_000;
};

const BUDGET_ERROR_TAG = "[stella-budget] ";

export const containerBudgetError = (message: string): Error => new Error(`${BUDGET_ERROR_TAG}${message}`);

// The user-facing text of an error the Sandbox threw because the owner's
// budget cannot cover the container, or null for any other error.
export const containerBudgetMessage = (error: unknown): string | null => {
  const text = error instanceof Error ? error.message : typeof error === "string" ? error : "";
  const at = text.indexOf(BUDGET_ERROR_TAG);
  return at < 0 ? null : text.slice(at + BUDGET_ERROR_TAG.length);
};

export const CONTAINER_BUDGET_MESSAGE =
  "Your Stella budget doesn't have enough left to keep a cloud workspace running. Add credit or upgrade to keep going, or wait until it resets.";

export const refusalMessage = (reservation: {
  message?: string;
  usageLimit?: StellaUsageLimit;
}): string => reservation.usageLimit?.message || reservation.message || CONTAINER_BUDGET_MESSAGE;
