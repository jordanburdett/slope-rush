import { useRef, useCallback, useEffect } from 'react'
import type { SpeedTier } from './constants'

// Root frequency per tier — all 4 voices derive from this root
const TIER_FREQ: Record<SpeedTier, number> = {
  1: 80,
  2: 120,
  3: 160,
  4: 220,
}

// BPM per tier for the arpeggio scheduler
const TIER_BPM: Record<SpeedTier, number> = {
  1: 80,
  2: 100,
  3: 120,
  4: 140,
}

// D minor pentatonic: semitone offsets from root
const PENTATONIC_STEPS = [0, 3, 7, 10, 14]

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
  /** Update all voice frequencies and gains for new tier */
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

  // Current tier for scheduler BPM
  const currentTierRef = useRef<SpeedTier>(1)

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

  // Scheduler timeout refs
  const arpeggioTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const drumTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Arpeggio step counter
  const arpStepRef = useRef<number>(0)

  // Tracks whether the lead voice is active (tiers 3–4 only)
  // Using a ref avoids reading AudioParam.value during a gain ramp
  const leadActiveRef = useRef<boolean>(false)

  const stopSchedulers = useCallback(() => {
    if (arpeggioTimeoutRef.current !== null) {
      clearInterval(arpeggioTimeoutRef.current as unknown as ReturnType<typeof setInterval>)
      arpeggioTimeoutRef.current = null
    }
    if (drumTimeoutRef.current !== null) {
      clearInterval(drumTimeoutRef.current as unknown as ReturnType<typeof setInterval>)
      drumTimeoutRef.current = null
    }
  }, [])

  // arpeggio tick — fires once per 16th note via setInterval stored in arpeggioTimeoutRef
  const scheduleArpeggio = useCallback(() => {
    const ctx = audioCtxRef.current
    const arpOsc = arpOscRef.current
    if (!ctx || !arpOsc) return

    const bpm = TIER_BPM[currentTierRef.current]
    const intervalMs = 60000 / (bpm * 4) // 16th note at current tier BPM

    // Track the interval duration this scheduler instance was started with
    let currentIntervalMs = intervalMs

    const arpeggioInterval = setInterval(() => {
      if (audioCtxRef.current === null) {
        // Context closed — stop interval
        clearInterval(arpeggioInterval)
        arpeggioTimeoutRef.current = null
        return
      }

      // Re-read BPM and restart with new interval if tempo has changed
      const newIntervalMs = 60000 / (TIER_BPM[currentTierRef.current as keyof typeof TIER_BPM] * 4)
      if (Math.abs(newIntervalMs - currentIntervalMs) > 1) {
        clearInterval(arpeggioInterval)
        arpeggioTimeoutRef.current = null
        scheduleArpeggio()
        return
      }

      const tickCtx = audioCtxRef.current
      const tickOsc = arpOscRef.current
      if (!tickCtx || !tickOsc) return

      const step = arpStepRef.current
      const semitones = PENTATONIC_STEPS[step % PENTATONIC_STEPS.length]
      const rootHz = currentRootHzRef.current
      const targetHz = rootHz * Math.pow(2, semitones / 12)
      try {
        tickOsc.frequency.setValueAtTime(targetHz, tickCtx.currentTime)
      } catch { /* ignore */ }
      arpStepRef.current = (step + 1) % PENTATONIC_STEPS.length
    }, intervalMs)

    arpeggioTimeoutRef.current = arpeggioInterval as unknown as ReturnType<typeof setTimeout>
  }, [])

  // drum tick — fires once per quarter note at BPM 140 via setInterval
  const scheduleDrum = useCallback(() => {
    const ctx = audioCtxRef.current
    if (!ctx) return

    const intervalMs = 60000 / (140 * 1) // quarter note at BPM 140

    const tick = () => {
      if (audioCtxRef.current === null) {
        if (drumTimeoutRef.current !== null) {
          clearInterval(drumTimeoutRef.current as unknown as ReturnType<typeof setInterval>)
          drumTimeoutRef.current = null
        }
        return
      }
      const tickCtx = audioCtxRef.current
      const tickMasterGain = masterGainRef.current
      if (!tickCtx || !tickMasterGain) return

      try {
        // 64ms white noise burst filtered at ~200Hz bandpass
        const bufferSize = Math.floor(tickCtx.sampleRate * 0.064)
        const buffer = tickCtx.createBuffer(1, bufferSize, tickCtx.sampleRate)
        const data = buffer.getChannelData(0)
        for (let i = 0; i < bufferSize; i++) {
          data[i] = Math.random() * 2 - 1
        }
        const source = tickCtx.createBufferSource()
        source.buffer = buffer

        const filter = tickCtx.createBiquadFilter()
        filter.type = 'bandpass'
        filter.frequency.setValueAtTime(200, tickCtx.currentTime)
        filter.Q.setValueAtTime(0.5, tickCtx.currentTime)

        const gain = tickCtx.createGain()
        gain.gain.setValueAtTime(0.08, tickCtx.currentTime)

        source.connect(filter)
        filter.connect(gain)
        gain.connect(tickMasterGain)
        source.start()
        source.stop(tickCtx.currentTime + 0.065)
      } catch { /* ignore */ }
    }

    drumTimeoutRef.current = setInterval(tick, intervalMs) as unknown as ReturnType<typeof setTimeout>
  }, [])

  const startAudio = useCallback(() => {
    // Stop any running schedulers first
    stopSchedulers()

    // Guard: already running — reset gains to tier-1 and restart schedulers
    if (audioCtxRef.current) {
      const ctx = audioCtxRef.current
      try {
        if (leadGainRef.current) {
          leadGainRef.current.gain.setValueAtTime(0, ctx.currentTime)
        }
        if (arpGainRef.current) {
          arpGainRef.current.gain.setValueAtTime(0, ctx.currentTime)
        }
        if (bassGainRef.current) {
          bassGainRef.current.gain.setValueAtTime(0.18, ctx.currentTime)
        }
        if (padGainRef.current) {
          padGainRef.current.gain.setValueAtTime(0.04, ctx.currentTime)
        }
      } catch { /* ignore */ }
      currentTierRef.current = 1
      arpStepRef.current = 0
      leadActiveRef.current = false
      return
    }

    try {
      const ctx = new AudioContext()
      audioCtxRef.current = ctx

      const rootFreq = TIER_FREQ[1]
      currentRootHzRef.current = rootFreq
      currentTierRef.current = 1
      arpStepRef.current = 0
      leadActiveRef.current = false

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

      // ── Arpeggio voice — starts silent; scheduler starts at tier 2+ ─────
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
  }, [stopSchedulers])

  const stopAudio = useCallback(() => {
    const ctx = audioCtxRef.current
    const masterGain = masterGainRef.current
    if (!ctx || !masterGain) return

    // Stop schedulers before nulling context so callbacks guard correctly
    stopSchedulers()

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
  }, [stopSchedulers])

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
      const rampEnd = ctx.currentTime + 0.3

      // Track the current root so triggerObstacle can compute lead target Hz
      currentRootHzRef.current = rootFreq
      currentTierRef.current = tier

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

      // ── Voice gating per tier ────────────────────────────────────────────
      // Tier 1: bass=0.18, pad=0.04, lead=0.0, arp=0.0
      // Tier 2: bass=0.18, pad=0.06, lead=0.0, arp=0.10
      // Tier 3: bass=0.18, pad=0.06, lead=0.08, arp=0.10
      // Tier 4: bass=0.22, pad=0.06, lead=0.10, arp=0.12
      const bassGain = bassGainRef.current
      const padGain = padGainRef.current
      const leadGain = leadGainRef.current
      const arpGain = arpGainRef.current

      if (bassGain) {
        const bassTarget = tier === 4 ? 0.22 : 0.18
        bassGain.gain.linearRampToValueAtTime(bassTarget, rampEnd)
      }
      if (padGain) {
        const padTarget = tier === 1 ? 0.04 : 0.06
        padGain.gain.linearRampToValueAtTime(padTarget, rampEnd)
      }
      if (leadGain) {
        const leadTarget = tier === 3 ? 0.08 : tier === 4 ? 0.10 : 0.0
        leadGain.gain.linearRampToValueAtTime(leadTarget, rampEnd)
        // Track lead active state via ref to avoid reading AudioParam.value during ramp
        leadActiveRef.current = tier >= 3
      }
      if (arpGain) {
        const arpTarget = tier === 1 ? 0.0 : tier === 2 ? 0.10 : tier === 3 ? 0.10 : 0.12
        arpGain.gain.linearRampToValueAtTime(arpTarget, rampEnd)
      }

      // ── Start/stop schedulers based on tier ─────────────────────────────
      // Arpeggio joins at tier 2+, drum joins at tier 4
      if (tier >= 2) {
        // Only restart arpeggio if not already running
        if (arpeggioTimeoutRef.current === null) {
          arpStepRef.current = 0
          scheduleArpeggio()
        }
      } else {
        // Tier 1 — stop arpeggio scheduler
        if (arpeggioTimeoutRef.current !== null) {
          clearInterval(arpeggioTimeoutRef.current as unknown as ReturnType<typeof setInterval>)
          arpeggioTimeoutRef.current = null
        }
      }

      if (tier === 4) {
        // Only start drum scheduler if not already running
        if (drumTimeoutRef.current === null) {
          scheduleDrum()
        }
      } else {
        // Below tier 4 — stop drum scheduler
        if (drumTimeoutRef.current !== null) {
          clearInterval(drumTimeoutRef.current as unknown as ReturnType<typeof setInterval>)
          drumTimeoutRef.current = null
        }
      }
    } catch { /* ignore */ }
  }, [scheduleArpeggio, scheduleDrum])

  const triggerObstacle = useCallback((type: string) => {
    const ctx = audioCtxRef.current
    const leadOsc = leadOscRef.current
    if (!ctx || !leadOsc) return

    // Skip if lead voice is not active (tiers 1–2); use ref to avoid reading
    // AudioParam.value during a gain ramp which can return stale values
    if (!leadActiveRef.current) return

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
