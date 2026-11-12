import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import path from "node:path";

type Backend = "in-app" | "external";

export const TASK_TABS_CLOSE_GRACE_MS = 5 * 60_000;
export const TASK_TABS_ORPHAN_AGE_MS = 12 * 60 * 60_000;
const REMEMBERED_TABS_MAX_AGE_MS = 30 * 24 * 60 * 60_000;
const MAX_REMEMBERED_TABS = 20;
const USED_AT_PERSIST_STEP_MS = 5 * 60_000;
const MAX_REPORT_CHARS = 20_000;
export const TASK_TABS_FIRST_SWEEP_DELAY_MS = 30_000;
export const TASK_TABS_SWEEP_INTERVAL_MS = 60_000;

export type RememberedTab = Readonly<{ url: string; title: string }>;
export type RememberedTabs = Readonly<{
  tabs: readonly RememberedTab[];
  activeIndex: number;
  closedAt: number;
}>;

type OwnerRecord = {
  backends: Backend[];
  usedAt: number;
  closeAt?: number;
  report?: string;
  left?: Partial<Record<Backend, number[]>>;
  remembered?: Partial<Record<Backend, RememberedTabs>>;
};

export type TabsToRetire = Readonly<{
  left: readonly number[];
  report?: string;
}>;

const isBackend = (value: unknown): value is Backend =>
  value === "in-app" || value === "external";

const readRemembered = (value: unknown): RememberedTabs | undefined => {
  if (!value || typeof value !== "object") return undefined;
  const record = value as Record<string, unknown>;
  if (!Array.isArray(record.tabs) || typeof record.closedAt !== "number")
    return undefined;
  const tabs = record.tabs
    .filter(
      (tab): tab is RememberedTab =>
        !!tab &&
        typeof (tab as RememberedTab).url === "string" &&
        typeof (tab as RememberedTab).title === "string",
    )
    .slice(0, MAX_REMEMBERED_TABS);
  if (tabs.length === 0) return undefined;
  const activeIndex =
    typeof record.activeIndex === "number" &&
    record.activeIndex >= 0 &&
    record.activeIndex < tabs.length
      ? Math.floor(record.activeIndex)
      : 0;
  return { tabs, activeIndex, closedAt: record.closedAt };
};

const readOwners = (raw: unknown): Record<string, OwnerRecord> => {
  const owners: Record<string, OwnerRecord> = Object.create(null);
  const source =
    raw && typeof raw === "object"
      ? ((raw as { owners?: unknown }).owners ?? {})
      : {};
  if (!source || typeof source !== "object") return owners;
  for (const [owner, value] of Object.entries(source)) {
    if (!value || typeof value !== "object") continue;
    const record = value as Record<string, unknown>;
    const backends = Array.isArray(record.backends)
      ? [...new Set(record.backends.filter(isBackend))]
      : [];
    const remembered: Partial<Record<Backend, RememberedTabs>> = {};
    if (record.remembered && typeof record.remembered === "object") {
      for (const [backend, set] of Object.entries(record.remembered)) {
        const parsed = readRemembered(set);
        if (isBackend(backend) && parsed) remembered[backend] = parsed;
      }
    }
    const left: Partial<Record<Backend, number[]>> = {};
    if (record.left && typeof record.left === "object") {
      for (const [backend, tabIds] of Object.entries(record.left)) {
        if (isBackend(backend) && Array.isArray(tabIds)) {
          left[backend] = tabIds.filter((tabId) => Number.isInteger(tabId));
        }
      }
    }
    owners[owner] = {
      backends,
      usedAt: typeof record.usedAt === "number" ? record.usedAt : 0,
      ...(typeof record.closeAt === "number" ? { closeAt: record.closeAt } : {}),
      ...(typeof record.report === "string" ? { report: record.report } : {}),
      ...(Object.keys(left).length > 0 ? { left } : {}),
      ...(Object.keys(remembered).length > 0 ? { remembered } : {}),
    };
  }
  return owners;
};

/**
 * Which browser tabs each task (browser owner) has open, when they should
 * close, and what was open when they did, so a resumed task gets them back.
 * Persisted so a scheduled close survives a restart of Stella.
 */
export class TaskTabs {
  private readonly owners: Record<string, OwnerRecord>;
  private readonly running = new Set<string>();
  private readonly persistedUsedAt = new Map<string, number>();

  constructor(private readonly file?: string) {
    let raw: unknown;
    try {
      raw = file ? JSON.parse(readFileSync(file, "utf8")) : undefined;
    } catch {
      raw = undefined;
    }
    this.owners = readOwners(raw);
  }

  used(owner: string, backend: Backend, now = Date.now()): void {
    const record = (this.owners[owner] ??= { backends: [], usedAt: now });
    let changed = false;
    if (!record.backends.includes(backend)) {
      record.backends.push(backend);
      changed = true;
    }
    if (record.closeAt !== undefined) {
      delete record.closeAt;
      changed = true;
    }
    record.usedAt = now;
    if (changed || now - (this.persistedUsedAt.get(owner) ?? 0) >= USED_AT_PERSIST_STEP_MS) {
      this.persist();
    }
  }

  started(owner: string): void {
    this.running.add(owner);
    const record = this.owners[owner];
    if (record?.closeAt === undefined) return;
    delete record.closeAt;
    this.persist();
  }

  ended(
    owner: string,
    keepTabs: boolean,
    report?: string,
    now = Date.now(),
  ): void {
    this.running.delete(owner);
    const record = this.owners[owner];
    if (!record || record.backends.length === 0) return;
    if (report?.trim()) record.report = report.slice(0, MAX_REPORT_CHARS);
    if (!keepTabs) record.closeAt = now + TASK_TABS_CLOSE_GRACE_MS;
    this.persist();
  }

  /** A tab the task left open for the user: kept, and released to them, when the task's tabs close. */
  leftForUser(owner: string, backend: Backend, tabId: number): void {
    const record = this.owners[owner];
    if (!record) return;
    const left = (record.left ??= {});
    const tabIds = (left[backend] ??= []);
    if (tabIds.includes(tabId)) return;
    tabIds.push(tabId);
    this.persist();
  }

  toRetire(owner: string, backend: Backend): TabsToRetire {
    const record = this.owners[owner];
    return {
      left: [...(record?.left?.[backend] ?? [])],
      ...(record?.report ? { report: record.report } : {}),
    };
  }

  /** Owners whose tabs should close now: past their grace period, or untouched for long and not running here. */
  due(now = Date.now()): string[] {
    return Object.entries(this.owners)
      .filter(
        ([owner, record]) =>
          record.backends.length > 0 &&
          !this.running.has(owner) &&
          (record.closeAt !== undefined
            ? record.closeAt <= now
            : record.usedAt <= now - TASK_TABS_ORPHAN_AGE_MS),
      )
      .map(([owner]) => owner);
  }

  backends(owner: string): readonly Backend[] {
    return [...(this.owners[owner]?.backends ?? [])];
  }

  retired(owner: string, backend: Backend, remembered?: RememberedTabs): void {
    const record = this.owners[owner];
    if (!record) return;
    record.backends = record.backends.filter((entry) => entry !== backend);
    if (record.left) delete record.left[backend];
    if (remembered && remembered.tabs.length > 0) {
      record.remembered = {
        ...record.remembered,
        [backend]: {
          ...remembered,
          tabs: remembered.tabs.slice(0, MAX_REMEMBERED_TABS),
          activeIndex: Math.min(remembered.activeIndex, MAX_REMEMBERED_TABS - 1),
        },
      };
    }
    if (record.backends.length === 0) {
      delete record.closeAt;
      delete record.report;
      delete record.left;
    }
    this.persist();
  }

  takeRemembered(owner: string, backend: Backend): RememberedTabs | undefined {
    const remembered = this.owners[owner]?.remembered?.[backend];
    if (!remembered) return undefined;
    delete this.owners[owner]!.remembered![backend];
    this.persist();
    return remembered;
  }

  putBack(owner: string, backend: Backend, remembered: RememberedTabs): void {
    const record = (this.owners[owner] ??= { backends: [], usedAt: Date.now() });
    record.remembered = { ...record.remembered, [backend]: remembered };
    this.persist();
  }

  private persist(now = Date.now()): void {
    for (const [owner, record] of Object.entries(this.owners)) {
      if (record.remembered) {
        for (const backend of Object.keys(record.remembered) as Backend[]) {
          if (record.remembered[backend]!.closedAt < now - REMEMBERED_TABS_MAX_AGE_MS) {
            delete record.remembered[backend];
          }
        }
        if (Object.keys(record.remembered).length === 0) delete record.remembered;
      }
      if (record.backends.length === 0 && !record.remembered && !this.running.has(owner)) {
        delete this.owners[owner];
        this.persistedUsedAt.delete(owner);
      } else {
        this.persistedUsedAt.set(owner, record.usedAt);
      }
    }
    if (!this.file) return;
    try {
      mkdirSync(path.dirname(this.file), { recursive: true });
      const temporary = `${this.file}.${process.pid}.tmp`;
      writeFileSync(temporary, JSON.stringify({ version: 1, owners: this.owners }));
      renameSync(temporary, this.file);
    } catch {}
  }
}

export const rememberableTabUrl = (url: string): boolean =>
  /^(https?|file):/i.test(url);

/** Whether a task's final report points the user at this tab, by its address or its title. */
export const reportMentionsTab = (
  report: string,
  tab: Readonly<{ url?: string; title?: string }>,
): boolean => {
  const text = report.toLowerCase();
  try {
    const url = new URL(tab.url ?? "");
    const address = `${url.hostname.replace(/^www\./, "")}${url.pathname.replace(/\/+$/, "")}`.toLowerCase();
    if (address.length >= 4 && text.includes(address)) return true;
  } catch {}
  const title = (tab.title ?? "").trim().toLowerCase();
  return title.length >= 8 && text.includes(title);
};
