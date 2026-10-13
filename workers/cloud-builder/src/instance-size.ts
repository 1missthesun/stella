/**
 * Right-sizing for sandbox containers.
 *
 * The Sandbox object passes the tier's instance to `ctx.container.start()`,
 * so one class runs every size. Memory and disk are billed as provisioned
 * while a container runs and CPU only as used, so each tier provisions as
 * little memory as its work needs (measured: a cloud agent uses 0.2-0.4 GB,
 * at most ~0.9 GB; a monorepo typecheck peaks at ~1 GB) and a whole vCPU,
 * which costs nothing while idle.
 *
 * - `small`: every agent and the orchestrator. Custom 1 vCPU / 3 GiB / 12 GB,
 *   the smallest custom instance. The predefined ones below it (`basic`:
 *   1/4 vCPU, 1 GiB, 4 GB) cannot hold a full world (up to 4 GiB) beside the
 *   1.3 GB image, and leave Claude Code's own ~0.9 GB peaks no headroom.
 * - `heavy`: work on a big repository, whose dependencies alone can fill
 *   12 GB (stella-v2's node_modules is 11 GB). Same memory, a 20 GB disk.
 *   Chosen when the agent is spawned with `workspace: "large"`, or after an
 *   agent's `small` container ran out of disk.
 * - `large`: standard-4 (4 vCPU / 12 GiB / 20 GB), the largest there is.
 *   App builds, and an agent whose container ran out of memory.
 */

export type InstanceSize = "small" | "heavy" | "large";

export const INSTANCE_SIZES: readonly InstanceSize[] = ["small", "heavy", "large"];

export const isInstanceSize = (value: unknown): value is InstanceSize =>
  value === "small" || value === "heavy" || value === "large";

/** What `ctx.container.start()` takes as `instance`. */
export type ContainerInstance =
  | "standard-4"
  | { vcpu: number; memoryMib: number; diskMb: number };

export const INSTANCE_TIERS: Record<
  InstanceSize,
  {
    instance: ContainerInstance;
    /** For logs and telemetry: the instance as one short string. */
    instanceType: string;
    vCpu: number;
    memoryBytes: number;
    diskBytes: number;
  }
> = {
  small: {
    instance: { vcpu: 1, memoryMib: 3 * 1024, diskMb: 12_000 },
    instanceType: "custom-1-3g-12g",
    vCpu: 1,
    memoryBytes: 3 * 1024 ** 3,
    diskBytes: 12_000 * 1000 ** 2,
  },
  heavy: {
    instance: { vcpu: 1, memoryMib: 3 * 1024, diskMb: 20_000 },
    instanceType: "custom-1-3g-20g",
    vCpu: 1,
    memoryBytes: 3 * 1024 ** 3,
    diskBytes: 20_000 * 1000 ** 2,
  },
  large: {
    instance: "standard-4",
    instanceType: "standard-4",
    vCpu: 4,
    memoryBytes: 12 * 1024 ** 3,
    diskBytes: 20 * 1000 ** 3,
  },
};

/**
 * One latest snapshot and one dependencies archive per disk class, so a
 * container never starts from a disk bigger than its own: an agent's small
 * container never inherits what a big-repo agent installed.
 */
export type DiskClass = "standard" | "large";

export const diskClass = (size: InstanceSize): DiskClass =>
  INSTANCE_TIERS[size].diskBytes > INSTANCE_TIERS.small.diskBytes
    ? "large"
    : "standard";

/** What the agent's spawn asked its container to be: `workspace: "large"` is `heavy`. */
export const initialInstanceSize = (args: {
  workspace?: "large" | undefined;
}): InstanceSize => (args.workspace === "large" ? "heavy" : "small");

/** The size an agent's container moves to after it ran out of memory, if any is larger. */
export const sizeAfterOutOfMemory = (size: InstanceSize): InstanceSize | null =>
  size === "large" ? null : "large";

/** The size an agent's container moves to after it ran out of disk, if any is larger. */
export const sizeAfterOutOfDisk = (size: InstanceSize): InstanceSize | null =>
  size === "small" ? "heavy" : null;

/** Which of two sizes is bigger, for keeping a thread's largest size. */
export const largerSize = (a: InstanceSize, b: InstanceSize): InstanceSize =>
  INSTANCE_SIZES.indexOf(a) >= INSTANCE_SIZES.indexOf(b) ? a : b;

// 137 = 128 + SIGKILL, which is what the kernel OOM killer leaves behind;
// the rest are the messages bun, node, and the container runtime print on
// the way down.
const OOM_PATTERN =
  /(out of memory|oom[- ]?kill|OOMKilled|JavaScript heap out of memory|ENOMEM|Cannot allocate memory|signal 9|SIGKILL|exit(ed)? (with )?(code )?137)/i;

export const isOutOfMemoryFailure = (args: {
  exitCode?: number;
  stdout?: string;
  stderr?: string;
  message?: string;
}): boolean => {
  if (args.exitCode === 137) return true;
  const haystack = [args.stderr, args.stdout, args.message]
    .filter((value): value is string => Boolean(value))
    .join("\n")
    .slice(-8_000);
  return OOM_PATTERN.test(haystack);
};

const GB = 1000 ** 3;

/** How a size reads to the user and the agent: "1 vCPU, 3 GiB memory, 12 GB disk". */
export const describeInstanceSize = (size: InstanceSize): string => {
  const tier = INSTANCE_TIERS[size];
  return `${tier.vCpu} vCPU, ${tier.memoryBytes / 1024 ** 3} GiB memory, ${Math.round(tier.diskBytes / GB)} GB disk`;
};
