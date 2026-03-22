import { useRef, useCallback, useEffect } from 'react'
import type { SpeedTier } from './constants'

// Root frequency per tier — all 4 voices derive from this root
const TIER_FREQ: Record<SpeedTier, number> = {
  1: 80,
  2: 120,
  3: 160,
  4: 220,
}

/**
 * Semitone offsets for each obstacle type.
 * Applied to the lead voice when the ball enters an obstacle zone.
 * Exported for unit test coverage.
 */
export const CHORD_DEGREES: Record<string, number> = {
  'narrowing':  3,   // minor third — tension
  'gap':        6,   // tritone — maximum tension
  'spike':      1,   // minor second — harsh dissonance
  'speed_pad':  11,  // major seventh — bright resolution
  'none':       0,   // root, no change
}

export interface AudioControls {
  /** Call inside the user-gesture handler (startGame) to create AudioContext */
  startAudio: () => void
  /** Ramp master gain to 0 over 0.5s then close context (on death) */
  stopAudio: () => void
  /** Trigger death noise burst — routes direct to destination, unaffected by master ramp */
  triggerDeath: () => void
  /** Trigger tier-up chime — routes direct to destination, unaffected by master ramp */
  triggerTierUp: () => void
  /** Update all voice frequencies for new tier */
  setTier: (tier: SpeedTier) => void
  /** Set master filter cutoff directly (called every frame — no ramp) */
  setFilterCutoff: (hz: number) => void
  /**
   * Trigger a chord-degree bend on the lead oscillator for the given obstacle type.
   * Bends to the target semitone offset immediately, then returns to root after 200ms.
   * No-op when lead gain is 0 (tiers 1–2, lead not yet active).
   */
  triggerObstacle: (type: string) => void
}

export function useAudio(): AudioControls {
  const audioCtxRef = useRef<AudioContext | null>(null)

  // Tracks current tier root frequency so triggerObstacle can compute lead target Hz
  const currentRootHzRef = useRef<number>(80)

  // Four persistent voice oscillators
  const bassOscRef = useRef<OscillatorNode | null>(null)
  const padOscRef = useRef<OscillatorNode | null>(null)
  const leadOscRef = useRef<OscillatorNode | null>(null)
  const arpOscRef = useRef<OscillatorNode | null>(null)

  // Per-voice gain nodes
  const bassGainRef = useRef<GainNode | null>(null)
  const padGainRef = useRef<GainNode | null>(null)
  const leadGainRef = useRef<GainNode | null>(null)
  const arpGainRef = useRef<GainNode | null>(null)

  // Master bus
  const masterGainRef = useRef<GainNode | null>(null)
  const masterFilterRef = useRef<BiquadFilterNode | null>(null)

  const startAudio = useCallback(() => {
    // Guard: already running
    if (audioCtxRef.current) return

    try {
      const ctx = new AudioContext()
      audioCtxRef.current = ctx

      const rootFreq = TIER_FREQ[1]

      // ── Master bus ───────────────────────────────────────────────────────
      const masterGain = ctx.createGain()
      masterGain.gain.setValueAtTime(0.7, ctx.currentTime)

      const masterFilter = ctx.createBiquadFilter()
      masterFilter.type = 'lowpass'
      masterFilter.Q.setValueAtTime(1.0, ctx.currentTime)
      masterFilter.frequency.setValueAtTime(400, ctx.currentTime)

      // Chain: masterGain → masterFilter → destination
      masterGain.connect(masterFilter)
      masterFilter.connect(ctx.destination)

      masterGainRef.current = masterGain
      masterFilterRef.current = masterFilter

      // ── Bass voice ───────────────────────────────────────────────────────
      const bassOsc = ctx.createOscillator()
      bassOsc.type = 'sawtooth'
      bassOsc.frequency.setValueAtTime(rootFreq, ctx.currentTime)

      const bassGain = ctx.createGain()
      bassGain.gain.setValueAtTime(0.18, ctx.currentTime)

      bassOsc.connect(bassGain)
      bassGain.connect(masterGain)
      bassOsc.start()

      bassOscRef.current = bassOsc
      bassGainRef.current = bassGain

      // ── Pad voice (root + fifth = root * 1.5) ───────────────────────────
      const padOsc = ctx.createOscillator()
      padOsc.type = 'sine'
      padOsc.frequency.setValueAtTime(rootFreq * 1.5, ctx.currentTime)

      const padGain = ctx.createGain()
      padGain.gain.setValueAtTime(0.04, ctx.currentTime)

      padOsc.connect(padGain)
      padGain.connect(masterGain)
      padOsc.start()

      padOscRef.current = padOsc
      padGainRef.current = padGain

      // ── Lead voice (root + octave = root * 2) — starts silent ───────────
      const leadOsc = ctx.createOscillator()
      leadOsc.type = 'square'
      leadOsc.frequency.setValueAtTime(rootFreq * 2, ctx.currentTime)

      const leadGain = ctx.createGain()
      leadGain.gain.setValueAtTime(0.0, ctx.currentTime)

      leadOsc.connect(leadGain)
      leadGain.connect(masterGain)
      leadOsc.start()

      leadOscRef.current = leadOsc
      leadGainRef.current = leadGain

      // ── Arpeggio voice — starts silent; scheduling deferred to story-003 ─
      const arpOsc = ctx.createOscillator()
      arpOsc.type = 'triangle'
      arpOsc.frequency.setValueAtTime(rootFreq, ctx.currentTime)

      const arpGain = ctx.createGain()
      arpGain.gain.setValueAtTime(0.0, ctx.currentTime)

      arpOsc.connect(arpGain)
      arpGain.connect(masterGain)
      arpOsc.start()

      arpOscRef.current = arpOsc
      arpGainRef.current = arpGain
    } catch {
      // Web Audio not available — silently continue
    }
  }, [])

  const stopAudio = useCallback(() => {
    const ctx = audioCtxRef.current
    const masterGain = masterGainRef.current
    if (!ctx || !masterGain) return

    // Null synchronously so startAudio() can proceed immediately on restart
    // without hitting the `if (audioCtxRef.current) return` guard.
    // The captured `ctx` local is used inside the closure for teardown.
    audioCtxRef.current = null

    masterGain.gain.setTargetAtTime(0, ctx.currentTime, 0.15)
    setTimeout(() => {
      if (!ctx) return
      try { bassOscRef.current?.stop() } catch { /* already stopped */ }
      try { padOscRef.current?.stop() } catch { /* already stopped */ }
      try { leadOscRef.current?.stop() } catch { /* already stopped */ }
      try { arpOscRef.current?.stop() } catch { /* already stopped */ }
      try { ctx.close() } catch { /* ignore */ }
      bassOscRef.current = null
      padOscRef.current = null
      leadOscRef.current = null
      arpOscRef.current = null
      bassGainRef.current = null
      padGainRef.current = null
      leadGainRef.current = null
      arpGainRef.current = null
      masterGainRef.current = null
      masterFilterRef.current = null
    }, 600)
  }, [])

  const triggerDeath = useCallback(() => {
    const ctx = audioCtxRef.current
    if (!ctx) return

    try {
      // White noise burst — 300ms, routed DIRECT to destination (not via
      // master gain) so it fires even after master has ramped to 0 on death
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
      source.stop(ctx.currentTime + 0.31)
    } catch { /* ignore */ }
  }, [])

  const triggerTierUp = useCallback(() => {
    const ctx = audioCtxRef.current
    if (!ctx) return

    try {
      const now = ctx.currentTime

      // Two-note chime: C5 (523Hz) + G5 (784Hz), routed DIRECT to destination
      // so it fires even if master gain is ramping down
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
    const bassOsc = bassOscRef.current
    const padOsc = padOscRef.current
    const leadOsc = leadOscRef.current
    const arpOsc = arpOscRef.current
    if (!ctx) return

    try {
      const rootFreq = TIER_FREQ[tier]
      const timeConstant = 0.1

      // Track the current root so triggerObstacle can compute lead target Hz
      currentRootHzRef.current = rootFreq

      if (bassOsc) {
        bassOsc.frequency.setTargetAtTime(rootFreq, ctx.currentTime, timeConstant)
      }
      if (padOsc) {
        padOsc.frequency.setTargetAtTime(rootFreq * 1.5, ctx.currentTime, timeConstant)
      }
      if (leadOsc) {
        leadOsc.frequency.setTargetAtTime(rootFreq * 2, ctx.currentTime, timeConstant)
      }
      if (arpOsc) {
        arpOsc.frequency.setTargetAtTime(rootFreq, ctx.currentTime, timeConstant)
      }
    } catch { /* ignore */ }
  }, [])

  const triggerObstacle = useCallback((type: string) => {
    const ctx = audioCtxRef.current
    const leadOsc = leadOscRef.current
    const leadGain = leadGainRef.current
    if (!ctx || !leadOsc || !leadGain) return

    // Skip if lead is silent (tiers 1–2 where lead hasn't been activated yet)
    if (leadGain.gain.value === 0) return

    try {
      const semitones = CHORD_DEGREES[type] ?? 0
      const rootHz = currentRootHzRef.current
      // Lead voice runs at root × 2 (one octave up)
      const leadBaseHz = rootHz * 2
      const targetHz = leadBaseHz * Math.pow(2, semitones / 12)
      const now = ctx.currentTime

      // Snap to target immediately, then return to base after 200ms
      leadOsc.frequency.setTargetAtTime(targetHz, now, 0.01)
      leadOsc.frequency.setTargetAtTime(leadBaseHz, now + 0.2, 0.01)
    } catch { /* ignore */ }
  }, [])

  const setFilterCutoff = useCallback((hz: number) => {
    const filter = masterFilterRef.current
    if (!filter) return
    try {
      filter.frequency.value = hz
    } catch { /* ignore */ }
  }, [])

  // Tear down AudioContext when the component unmounts
  useEffect(() => {
    return () => stopAudio()
  }, [stopAudio])

  return { startAudio, stopAudio, triggerDeath, triggerTierUp, setTier, setFilterCutoff, triggerObstacle }
}
