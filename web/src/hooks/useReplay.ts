import { animate, useReducedMotion } from "motion/react"
import { useCallback, useEffect, useRef, useState } from "react"
import { liveAxisMs, REPLAY_SPEED } from "../lib/replay"

export function useReplay(totalMs: number, auto: boolean) {
  const reduce = useReducedMotion()
  const skip = Boolean(reduce)
  const [live, setLive] = useState(() => auto && !skip)
  const [nowMs, setNowMs] = useState(() => (auto && !skip ? 0 : totalMs))
  const [axisMs, setAxisMs] = useState(() => (auto && !skip ? liveAxisMs(0, totalMs) : totalMs))
  const axisRef = useRef(axisMs)
  const nowRef = useRef(nowMs)

  useEffect(() => {
    nowRef.current = nowMs
  }, [nowMs])

  const restart = useCallback(() => {
    if (skip) {
      setLive(false)
      setNowMs(totalMs)
      setAxisMs(totalMs)
      axisRef.current = totalMs
      return
    }
    setNowMs(0)
    nowRef.current = 0
    const first = liveAxisMs(0, totalMs)
    setAxisMs(first)
    axisRef.current = first
    setLive(true)
  }, [skip, totalMs])

  useEffect(() => {
    if (auto && !skip) restart()
    else {
      setLive(false)
      setNowMs(totalMs)
      setAxisMs(totalMs)
      axisRef.current = totalMs
    }
  }, [auto, skip, totalMs, restart])

  useEffect(() => {
    if (!live) return
    let raf = 0
    let last = performance.now()
    const tick = (t: number) => {
      const dt = (t - last) * REPLAY_SPEED
      last = t
      const next = Math.min(totalMs, nowRef.current + dt)
      nowRef.current = next
      setNowMs(next)
      if (next >= totalMs) {
        setLive(false)
        return
      }
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [live, totalMs])

  const targetAxis = live ? liveAxisMs(nowMs, totalMs) : totalMs

  useEffect(() => {
    const from = axisRef.current
    if (Math.abs(from - targetAxis) < 1) {
      axisRef.current = targetAxis
      setAxisMs(targetAxis)
      return
    }
    const ctrl = animate(from, targetAxis, {
      ease: [0.16, 1, 0.3, 1],
      duration: skip ? 0 : 0.48,
      onUpdate: (v) => {
        axisRef.current = v
        setAxisMs(v)
      },
    })
    return () => ctrl.stop()
  }, [targetAxis, skip])

  return { live, nowMs, axisMs, restart, done: !live && nowMs >= totalMs - 1 }
}
