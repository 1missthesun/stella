import { useCallback, useEffect, useRef, useState } from 'react'

const IDLE_THRESHOLD_MS = 60 * 60 * 1000
const CHECK_INTERVAL_MS = 30 * 1000

type UseIdleHomeVisibilityOptions = {
  hasMessages: boolean
  isStreaming: boolean
  onIdle?: () => void
}

type HomeVisibilityArgs = {
  hasMessages: boolean
  isStreaming: boolean
  isIdle: boolean
  isForcedHome: boolean
}

export function computeShowHomeContent({
  hasMessages,
  isStreaming,
  isIdle,
  isForcedHome,
}: HomeVisibilityArgs) {
  return isForcedHome || !hasMessages || (!isStreaming && isIdle)
}

export function useIdleHomeVisibility({
  hasMessages,
  isStreaming,
  onIdle,
}: UseIdleHomeVisibilityOptions) {
  const [isIdle, setIsIdle] = useState(false)
  const [isForcedHome, setIsForcedHome] = useState(false)
  const lastActivityRef = useRef(Date.now())
  const onIdleRef = useRef(onIdle)
  onIdleRef.current = onIdle

  const resetIdleTimer = useCallback(() => {
    lastActivityRef.current = Date.now()
    setIsForcedHome(false)
    setIsIdle(false)
  }, [])

  const forceShowHome = useCallback(() => {
    setIsForcedHome(true)
    setIsIdle(true)
  }, [])

  useEffect(() => {
    if (!hasMessages || isStreaming || isIdle) return

    const interval = setInterval(() => {
      if (Date.now() - lastActivityRef.current >= IDLE_THRESHOLD_MS) {
        setIsIdle(true)
        onIdleRef.current?.()
      }
    }, CHECK_INTERVAL_MS)

    return () => clearInterval(interval)
  }, [hasMessages, isStreaming, isIdle])

  const showHomeContent = computeShowHomeContent({
    hasMessages,
    isStreaming,
    isIdle,
    isForcedHome,
  })

  return { showHomeContent, resetIdleTimer, forceShowHome }
}
