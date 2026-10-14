import { useCallback, useEffect, useState } from "react"
import { getElectronApi } from "@/platform/electron/electron"
import type { ChatContext } from "@/shared/types/electron"

export type RecentAppChip = {
  kind: "app"
  pid: number
  name: string
  bundleId?: string
  isActive: boolean
  windowTitle?: string
  iconDataUrl?: string
}

export type BrowserTabChip = {
  kind: "tab"
  browser: string
  pid: number
  bundleId: string
  url: string
  title?: string
  host: string
  iconDataUrl?: string
}

export type SuggestionChip = RecentAppChip | BrowserTabChip

type SlotPhase = "stable" | "entering" | "leaving"

export type SuggestionSlot = {
  key: string
  chip: SuggestionChip
  phase: SlotPhase
}

export type SuggestionLane = {
  current: SuggestionSlot | null
  outgoing: SuggestionSlot | null
}

const LANE_COUNT = 3
const POLL_INTERVAL_MS = 5_000
const WINDOWS_POLL_INTERVAL_MS = 30_000
const WINDOWS_INITIAL_POLL_DELAY_MS = 8_000
const FADE_OUT_MS = 220

const getPollingConfig = () => {
  if (typeof window !== "undefined" && window.electronAPI?.platform === "win32") {
    return {
      initialDelayMs: WINDOWS_INITIAL_POLL_DELAY_MS,
      pollIntervalMs: WINDOWS_POLL_INTERVAL_MS,
    }
  }
  return { initialDelayMs: 0, pollIntervalMs: POLL_INTERVAL_MS }
}

const chipIdentity = (chip: SuggestionChip): string => {
  if (chip.kind === "tab") return `tab:${chip.bundleId}:${chip.url}`
  return `app:${chip.pid}:${chip.windowTitle ?? ""}`
}

const chipLooseId = (chip: SuggestionChip): string => {
  if (chip.kind === "tab") return `tab:${chip.bundleId}`
  return `app:${chip.pid}`
}

type LanesState = {
  lanes: SuggestionLane[]
  knownCandidateLooseIds: Set<string>
}

const emptyLane = (): SuggestionLane => ({ current: null, outgoing: null })

const emptyLanes = (): LanesState => ({
  lanes: Array.from({ length: LANE_COUNT }, emptyLane),
  knownCandidateLooseIds: new Set(),
})

const reconcileLanes = (
  prev: LanesState,
  candidates: SuggestionChip[],
): LanesState => {
  const candidatesByLoose = new Map<string, SuggestionChip>()
  const candidateLooseIdsInOrder: string[] = []
  for (const chip of candidates) {
    const loose = chipLooseId(chip)
    if (candidatesByLoose.has(loose)) continue
    candidatesByLoose.set(loose, chip)
    candidateLooseIdsInOrder.push(loose)
  }

  const isBootstrap = prev.knownCandidateLooseIds.size === 0

  const desiredLooseIds = candidateLooseIdsInOrder.slice(0, LANE_COUNT)
  const desiredSet = new Set(desiredLooseIds)

  const stagedLanes: SuggestionLane[] = prev.lanes.map((lane) => {
    const current = lane.current
    if (!current) return { current: null, outgoing: lane.outgoing }

    const looseId = chipLooseId(current.chip)
    if (desiredSet.has(looseId)) {
      const liveMatch = candidatesByLoose.get(looseId)!
      const sameContent =
        chipIdentity(liveMatch) === chipIdentity(current.chip) &&
        sameSurfaceFields(liveMatch, current.chip)
      const refreshed: SuggestionSlot = sameContent
        ? current.phase === "stable"
          ? current
          : { ...current, phase: "stable" }
        : { key: current.key, chip: liveMatch, phase: "stable" }
      return { current: refreshed, outgoing: lane.outgoing }
    }

    return {
      current: null,
      outgoing: { ...current, phase: "leaving" },
    }
  })

  const occupied = new Set<string>()
  for (const lane of stagedLanes) {
    if (lane.current) occupied.add(chipLooseId(lane.current.chip))
  }

  const remaining = desiredLooseIds.filter((loose) => !occupied.has(loose))
  let r = 0
  const finalLanes: SuggestionLane[] = stagedLanes.map((lane) => {
    if (lane.current) return lane
    if (r >= remaining.length) return lane
    const chip = candidatesByLoose.get(remaining[r++])
    if (!chip) return lane
    return {
      current: {
        key: makeSlotKey(chip),
        chip,
        phase: isBootstrap ? "stable" : "entering",
      },
      outgoing: lane.outgoing,
    }
  })

  if (
    lanesEqual(prev.lanes, finalLanes) &&
    setsEqual(prev.knownCandidateLooseIds, new Set(candidateLooseIdsInOrder))
  ) {
    return prev
  }

  return {
    lanes: finalLanes,
    knownCandidateLooseIds: new Set(candidateLooseIdsInOrder),
  }
}

const sameSurfaceFields = (a: SuggestionChip, b: SuggestionChip): boolean => {
  if (a.kind !== b.kind) return false
  if (a.kind === "tab" && b.kind === "tab") {
    return a.host === b.host && a.title === b.title && a.browser === b.browser
  }
  if (a.kind === "app" && b.kind === "app") {
    return a.name === b.name && a.isActive === b.isActive
  }
  return false
}

const makeSlotKey = (chip: SuggestionChip): string => {
  if (chip.kind === "tab") return `slot-tab-${chip.bundleId}-${Date.now()}`
  return `slot-app-${chip.pid}-${Date.now()}`
}

type LanesAction =
  | { type: "reconcile"; candidates: SuggestionChip[] }
  | { type: "advancePhase"; slotKey: string; phase: SlotPhase }
  | { type: "dropOutgoing"; slotKey: string }
  | { type: "clearChip"; slotKey: string }

const lanesReducer = (state: LanesState, action: LanesAction): LanesState => {
  switch (action.type) {
    case "reconcile":
      return reconcileLanes(state, action.candidates)
    case "advancePhase": {
      let changed = false
      const next = state.lanes.map((lane) => {
        if (lane.current && lane.current.key === action.slotKey) {
          if (lane.current.phase === action.phase) return lane
          changed = true
          return {
            ...lane,
            current: { ...lane.current, phase: action.phase },
          }
        }
        return lane
      })
      if (!changed) return state
      return { ...state, lanes: next }
    }
    case "dropOutgoing": {
      let changed = false
      const next = state.lanes.map((lane) => {
        if (lane.outgoing && lane.outgoing.key === action.slotKey) {
          changed = true
          return { ...lane, outgoing: null }
        }
        return lane
      })
      if (!changed) return state
      return { ...state, lanes: next }
    }
    case "clearChip": {
      let changed = false
      const next = state.lanes.map((lane) => {
        if (lane.current && lane.current.key === action.slotKey) {
          changed = true
          return {
            current: null,
            outgoing: { ...lane.current, phase: "leaving" as const },
          }
        }
        return lane
      })
      if (!changed) return state
      return { ...state, lanes: next }
    }
    default:
      return state
  }
}

const lanesEqual = (a: SuggestionLane[], b: SuggestionLane[]): boolean => {
  if (a.length !== b.length) return false
  for (let i = 0; i < a.length; i += 1) {
    if (a[i].current !== b[i].current) return false
    if (a[i].outgoing !== b[i].outgoing) return false
  }
  return true
}

const setsEqual = (a: Set<string>, b: Set<string>): boolean => {
  if (a.size !== b.size) return false
  for (const value of a) if (!b.has(value)) return false
  return true
}

type FetchSnapshotResult = {
  apps: RecentAppChip[]
  tab: BrowserTabChip | null
}

const fetchSnapshot = async (): Promise<FetchSnapshotResult> => {
  const api = getElectronApi()
  if (!api?.home?.listRecentApps) return { apps: [], tab: null }

  let apps: RecentAppChip[] = []
  try {
    const result = await api.home.listRecentApps(LANE_COUNT)
    apps = (result?.apps ?? []).map<RecentAppChip>((app) => ({
      kind: "app",
      pid: app.pid,
      name: app.name,
      bundleId: app.bundleId,
      isActive: app.isActive,
      windowTitle: app.windowTitle,
      iconDataUrl: app.iconDataUrl,
    }))
  } catch {
    apps = []
  }

  let tab: BrowserTabChip | null = null
  const activeBrowser = apps.find((app) => app.isActive && app.bundleId)
  if (activeBrowser?.bundleId && api.home.getActiveBrowserTab) {
    try {
      const result = await api.home.getActiveBrowserTab(activeBrowser.bundleId)
      const next = result?.tab ?? null
      if (next) {
        let host = ""
        try {
          host = new URL(next.url).hostname.replace(/^www\./, "")
        } catch {
          host = next.url
        }
        const tabBundleId = next.bundleId ?? activeBrowser.bundleId
        const browserApp =
          apps.find((app) => app.bundleId === tabBundleId) ?? activeBrowser
        tab = {
          kind: "tab",
          browser: next.browser,
          pid: browserApp.pid,
          bundleId: tabBundleId,
          url: next.url,
          title: next.title,
          host,
          iconDataUrl: browserApp.iconDataUrl,
        }
      }
    } catch {
      tab = null
    }
  }

  return { apps, tab }
}

const orderCandidates = ({ apps, tab }: FetchSnapshotResult): SuggestionChip[] => {
  const out: SuggestionChip[] = []
  if (tab) out.push(tab)
  const seenPids = new Set<number>()
  for (const app of apps) {
    if (seenPids.has(app.pid)) continue
    seenPids.add(app.pid)
    if (tab && app.bundleId === tab.bundleId) continue
    out.push(app)
  }
  return out
}

type CandidatesListener = (candidates: SuggestionChip[]) => void

const candidateListeners = new Set<CandidatesListener>()
let sharedInterval: number | null = null
let sharedInitialTimer: number | null = null
let sharedInFlight: Promise<void> | null = null
let detachSharedSurfaceListeners: (() => void) | null = null

const isSurfaceVisible = () => !document.hidden && document.hasFocus()

const refreshSharedCandidates = (): Promise<void> => {
  if (sharedInFlight) return sharedInFlight
  sharedInFlight = fetchSnapshot()
    .then((snapshot) => {
      const candidates = orderCandidates(snapshot)
      for (const listener of [...candidateListeners]) listener(candidates)
    })
    .finally(() => {
      sharedInFlight = null
    })
  return sharedInFlight
}

const stopSharedInterval = () => {
  if (sharedInterval !== null) {
    window.clearInterval(sharedInterval)
    sharedInterval = null
  }
}

const startSharedPolling = () => {
  if (!isSurfaceVisible()) return
  if (sharedInterval !== null) return
  void refreshSharedCandidates()
  sharedInterval = window.setInterval(
    refreshSharedCandidates,
    getPollingConfig().pollIntervalMs,
  )
}

const subscribeToRecentAppCandidates = (
  listener: CandidatesListener,
): (() => void) => {
  const { initialDelayMs } = getPollingConfig()
  candidateListeners.add(listener)
  let joinTimer: number | null = null

  if (candidateListeners.size === 1) {
    const handleVisibilityChange = () => {
      if (isSurfaceVisible()) startSharedPolling()
      else stopSharedInterval()
    }
    document.addEventListener("visibilitychange", handleVisibilityChange)
    window.addEventListener("focus", handleVisibilityChange)
    window.addEventListener("blur", handleVisibilityChange)
    detachSharedSurfaceListeners = () => {
      document.removeEventListener("visibilitychange", handleVisibilityChange)
      window.removeEventListener("focus", handleVisibilityChange)
      window.removeEventListener("blur", handleVisibilityChange)
    }
    if (initialDelayMs > 0) {
      sharedInitialTimer = window.setTimeout(() => {
        sharedInitialTimer = null
        startSharedPolling()
      }, initialDelayMs)
    } else {
      startSharedPolling()
    }
  } else {
    const refreshForJoin = () => {
      joinTimer = null
      if (sharedInterval !== null && isSurfaceVisible()) {
        void refreshSharedCandidates()
      }
    }
    if (initialDelayMs > 0) {
      joinTimer = window.setTimeout(refreshForJoin, initialDelayMs)
    } else {
      refreshForJoin()
    }
  }

  return () => {
    if (joinTimer !== null) window.clearTimeout(joinTimer)
    candidateListeners.delete(listener)
    if (candidateListeners.size > 0) return
    if (sharedInitialTimer !== null) {
      window.clearTimeout(sharedInitialTimer)
      sharedInitialTimer = null
    }
    stopSharedInterval()
    detachSharedSurfaceListeners?.()
    detachSharedSurfaceListeners = null
  }
}

type AutoContextChipsApi = {
  lanes: SuggestionLane[]
  dismissSlot: (slotKey: string) => void
}

export function useAutoContextChips(
  active: boolean = true,
): AutoContextChipsApi {
  const [state, setState] = useState(emptyLanes)
  const dispatch = useCallback((action: LanesAction) => {
    setState((prev) => lanesReducer(prev, action))
  }, [])

  useEffect(() => {
    if (!active) return
    const api = getElectronApi()
    if (!api?.home?.listRecentApps) return
    return subscribeToRecentAppCandidates((candidates) => {
      dispatch({ type: "reconcile", candidates })
    })
  }, [active, dispatch])

  useEffect(() => {
    const enteringSlots: SuggestionSlot[] = []
    for (const lane of state.lanes) {
      if (lane.current?.phase === "entering") enteringSlots.push(lane.current)
    }
    if (enteringSlots.length === 0) return undefined

    const raf = window.requestAnimationFrame(() => {
      for (const slot of enteringSlots) {
        dispatch({ type: "advancePhase", slotKey: slot.key, phase: "stable" })
      }
    })
    return () => window.cancelAnimationFrame(raf)
  }, [dispatch, state.lanes])

  useEffect(() => {
    const outgoingSlots: SuggestionSlot[] = []
    for (const lane of state.lanes) {
      if (lane.outgoing) outgoingSlots.push(lane.outgoing)
    }
    if (outgoingSlots.length === 0) return undefined

    const timers = outgoingSlots.map((slot) =>
      window.setTimeout(() => {
        dispatch({ type: "dropOutgoing", slotKey: slot.key })
      }, FADE_OUT_MS),
    )
    return () => {
      for (const timer of timers) window.clearTimeout(timer)
    }
  }, [dispatch, state.lanes])

  const dismissSlot = useCallback(
    (slotKey: string) => {
      dispatch({ type: "clearChip", slotKey })
    },
    [dispatch],
  )

  return {
    lanes: state.lanes,
    dismissSlot,
  }
}

export function appChipToChatContext(app: RecentAppChip): ChatContext {
  return {
    window: {
      title: app.windowTitle ?? "",
      app: app.name,
      bounds: { x: 0, y: 0, width: 0, height: 0 },
    },
    browserUrl: null,
    selectedText: null,
    regionScreenshots: [],
    windowScreenshot: null,
    windowAxTree: null,
    capturePending: true,
  }
}

export function tabChipToChatContext(tab: BrowserTabChip): ChatContext {
  return {
    window: {
      title: tab.title ?? "",
      app: tab.browser,
      bounds: { x: 0, y: 0, width: 0, height: 0 },
    },
    browserUrl: tab.url,
    selectedText: null,
    regionScreenshots: [],
    windowScreenshot: null,
    windowAxTree: null,
    capturePending: true,
  }
}
