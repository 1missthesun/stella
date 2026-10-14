export type InstanceSize = "small" | "heavy" | "large";

export const INSTANCE_SIZES: readonly InstanceSize[] = ["small", "heavy", "large"];

export const isInstanceSize = (value: unknown): value is InstanceSize =>
  value === "small" || value === "heavy" || value === "large";

export type ContainerInstance =
  | "standard-4"
  | { vcpu: number; memoryMib: number; diskMb: number };

export const INSTANCE_TIERS: Record<
  InstanceSize,
  {
    instance: ContainerInstance;
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

export type DiskClass = "standard" | "large";

export const diskClass = (size: InstanceSize): DiskClass =>
  INSTANCE_TIERS[size].diskBytes > INSTANCE_TIERS.small.diskBytes
    ? "large"
    : "standard";

export const initialInstanceSize = (args: {
  workspace?: "large" | undefined;
}): InstanceSize => (args.workspace === "large" ? "heavy" : "small");

export const sizeAfterOutOfMemory = (size: InstanceSize): InstanceSize | null =>
  size === "large" ? null : "large";

export const sizeAfterOutOfDisk = (size: InstanceSize): InstanceSize | null =>
  size === "small" ? "heavy" : null;

export const largerSize = (a: InstanceSize, b: InstanceSize): InstanceSize =>
  INSTANCE_SIZES.indexOf(a) >= INSTANCE_SIZES.indexOf(b) ? a : b;

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

export const describeInstanceSize = (size: InstanceSize): string => {
  const tier = INSTANCE_TIERS[size];
  return `${tier.vCpu} vCPU, ${tier.memoryBytes / 1024 ** 3} GiB memory, ${Math.round(tier.diskBytes / GB)} GB disk`;
};
