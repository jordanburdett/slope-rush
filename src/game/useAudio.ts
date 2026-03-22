import { useRef, useCallback } from 'react'
import type { SpeedTier } from './constants'

// Hum frequency per tier
const TIER_FREQ: Record<SpeedTier, number> = {
  1: 80,
  2: 120,
  3: 160,
  4: 220,
}

export interface AudioControls {
  /** Call inside the user-gesture handler (startGame) to create AudioContext */
  startAudio: () => void
  /** Fade hum out and stop (on death) */
  stopAudio: () => void
  /** Trigger death noise burst */
  triggerDeath: () => void
  /** Trigger tier-up chime */
  triggerTierUp: () => void
  /** Update hum frequency for new tier */
  setTier: (tier: SpeedTier) => void
}

export function useAudio(): AudioControls {
  const audioCtxRef = useRef<AudioContext | null>(null)
  const humOscRef = useRef<OscillatorNode | null>(null)
  const humGainRef = useRef<GainNode | null>(null)

  const startAudio = useCallback(() => {
    // Guard: already running
    if (audioCtxRef.current) return

    try {
      const ctx = new AudioContext()
      audioCtxRef.current = ctx

      // Master hum oscillator
      const osc = ctx.createOscillator()
      const gain = ctx.createGain()
      osc.type = 'sine'
      osc.frequency.setValueAtTime(TIER_FREQ[1], ctx.currentTime)
      gain.gain.setValueAtTime(0.08, ctx.currentTime)
      osc.connect(gain)
      gain.connect(ctx.destination)
      osc.start()

      humOscRef.current = osc
      humGainRef.current = gain
    } catch {
      // Web Audio not available — silently continue
    }
  }, [])

  const stopAudio = useCallback(() => {
    const ctx = audioCtxRef.current
    const gain = humGainRef.current
    const osc = humOscRef.current
    if (!ctx || !gain) return

    // Fade out over 200ms then tear down — capture ctx at call time to avoid
    // a stale timeout silencing a freshly-created AudioContext on restart
    gain.gain.setTargetAtTime(0, ctx.currentTime, 0.06)
    setTimeout(() => {
      // Only act if this is still the same context (not a restarted one)
      if (audioCtxRef.current !== ctx) return
      try { osc?.stop() } catch { /* oscillator may already be stopped */ }
      try { ctx.close() } catch { /* ignore */ }
      audioCtxRef.current = null
      humOscRef.current = null
      humGainRef.current = null
    }, 300)
  }, [])

  const triggerDeath = useCallback(() => {
    const ctx = audioCtxRef.current
    if (!ctx) return

    try {
      // White noise burst — 300ms
      const bufferSize = Math.floor(ctx.sampleRate * 0.3)
      const buffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate)
      const data = buffer.getChannelData(0)
      for (let i = 0; i < bufferSize; i++) {
        data[i] = Math.random() * 2 - 1
      }
      const source = ctx.createBufferSource()
      source.buffer = buffer

      const gain = ctx.createGain()
      gain.gain.setValueAtTime(0.3, ctx.currentTime)
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.3)

      source.connect(gain)
      gain.connect(ctx.destination)
      source.start()
    } catch { /* ignore */ }
  }, [])

  const triggerTierUp = useCallback(() => {
    const ctx = audioCtxRef.current
    if (!ctx) return

    try {
      const now = ctx.currentTime

      // Two-note chime: C5 (523Hz) + G5 (784Hz), 100ms with quick envelope
      const frequencies = [523, 784]
      for (const freq of frequencies) {
        const osc = ctx.createOscillator()
        const gain = ctx.createGain()
        osc.type = 'sine'
        osc.frequency.setValueAtTime(freq, now)
        gain.gain.setValueAtTime(0, now)
        gain.gain.linearRampToValueAtTime(0.25, now + 0.01)
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.1)
        osc.connect(gain)
        gain.connect(ctx.destination)
        osc.start(now)
        osc.stop(now + 0.12)
      }
    } catch { /* ignore */ }
  }, [])

  const setTier = useCallback((tier: SpeedTier) => {
    const ctx = audioCtxRef.current
    const osc = humOscRef.current
    if (!ctx || !osc) return

    try {
      osc.frequency.setTargetAtTime(TIER_FREQ[tier], ctx.currentTime, 0.1)
    } catch { /* ignore */ }
  }, [])

  return { startAudio, stopAudio, triggerDeath, triggerTierUp, setTier }
}
