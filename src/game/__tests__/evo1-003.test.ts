/**
 * Tests for slope-rush-evo1-003:
 * Per-tier voice density — sparse atmosphere at tier 1 escalating to dense synthwave at tier 4
 *
 * Covers:
 *   1. setTier(1) — lead gain=0, arp gain=0
 *   2. setTier(2) — arp gain ramps to 0.10
 *   3. setTier(3) — lead gain ramps to 0.08
 *   4. setTier(4) — lead ramps to 0.10, arp ramps to 0.12
 *   5. Arpeggio scheduler starts at tier 2 and stops when stopAudio is called
 *   6. setFilterCutoff maps speed to expected Hz range (400–8000)
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useAudio, type AudioControls } from '../useAudio'
import { INITIAL_SPEED, MAX_SPEED } from '../constants'

// ── Web Audio mock (same pattern as useAudio.test.ts) ────────────────────────

interface MockGainParam {
  value: number
  setValueAtTime: ReturnType<typeof vi.fn>
  setTargetAtTime: ReturnType<typeof vi.fn>
  exponentialRampToValueAtTime: ReturnType<typeof vi.fn>
  linearRampToValueAtTime: ReturnType<typeof vi.fn>
}

function makeMockFreqParam(initial = 0) {
  return {
    value: initial,
    setValueAtTime: vi.fn(),
    setTargetAtTime: vi.fn(),
    exponentialRampToValueAtTime: vi.fn(),
    linearRampToValueAtTime: vi.fn(),
  }
}

function makeMockGainParam(initial = 1): MockGainParam {
  return {
    value: initial,
    setValueAtTime: vi.fn(),
    setTargetAtTime: vi.fn(),
    exponentialRampToValueAtTime: vi.fn(),
    linearRampToValueAtTime: vi.fn(),
  }
}

const registry = {
  oscillators: [] as ReturnType<typeof makeMockOscillator>[],
  gains: [] as ReturnType<typeof makeMockGain>[],
  filters: [] as ReturnType<typeof makeMockFilter>[],
  bufferSources: [] as ReturnType<typeof makeMockBufferSource>[],
  ctxInstances: [] as ReturnType<typeof makeMockCtx>[],
}

function makeMockOscillator() {
  return {
    type: 'sine' as OscillatorType,
    frequency: makeMockFreqParam(),
    connect: vi.fn(),
    start: vi.fn(),
    stop: vi.fn(),
  }
}

function makeMockGain() {
  return {
    gain: makeMockGainParam(1),
    connect: vi.fn(),
  }
}

function makeMockFilter() {
  return {
    type: 'lowpass' as BiquadFilterType,
    frequency: makeMockFreqParam(),
    Q: makeMockFreqParam(1),
    connect: vi.fn(),
  }
}

function makeMockBufferSource() {
  return {
    buffer: null as AudioBuffer | null,
    connect: vi.fn(),
    start: vi.fn(),
    stop: vi.fn(),
  }
}

function makeMockCtx() {
  const ctx = {
    currentTime: 0,
    sampleRate: 44100,
    destination: {} as AudioDestinationNode,
    state: 'running' as AudioContextState,
    close: vi.fn().mockResolvedValue(undefined),

    createOscillator(): OscillatorNode {
      const osc = makeMockOscillator()
      registry.oscillators.push(osc)
      return osc as unknown as OscillatorNode
    },
    createGain(): GainNode {
      const gain = makeMockGain()
      registry.gains.push(gain)
      return gain as unknown as GainNode
    },
    createBiquadFilter(): BiquadFilterNode {
      const filter = makeMockFilter()
      registry.filters.push(filter)
      return filter as unknown as BiquadFilterNode
    },
    createBufferSource(): AudioBufferSourceNode {
      const src = makeMockBufferSource()
      registry.bufferSources.push(src)
      return src as unknown as AudioBufferSourceNode
    },
    createBuffer(channels: number, length: number, sampleRate: number): AudioBuffer {
      const data = new Float32Array(length)
      return {
        length,
        sampleRate,
        numberOfChannels: channels,
        duration: length / sampleRate,
        getChannelData: () => data,
        copyFromChannel: vi.fn(),
        copyToChannel: vi.fn(),
      } as unknown as AudioBuffer
    },
  }
  registry.ctxInstances.push(ctx)
  return ctx
}

beforeEach(() => {
  registry.oscillators = []
  registry.gains = []
  registry.filters = []
  registry.bufferSources = []
  registry.ctxInstances = []

  const FakeAudioContext = function (this: unknown) {
    const ctx = makeMockCtx()
    Object.assign(this as object, ctx)
  } as unknown as typeof AudioContext

  vi.stubGlobal('AudioContext', FakeAudioContext)
  vi.useFakeTimers()
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

function renderAndStart() {
  const { result } = renderHook<AudioControls, void>(() => useAudio())
  act(() => {
    result.current.startAudio()
  })
  return result
}

/**
 * Gain node layout after startAudio():
 *   gains[0] = masterGain
 *   gains[1] = bassGain
 *   gains[2] = padGain
 *   gains[3] = leadGain
 *   gains[4] = arpGain
 *
 * rampEnd = ctx.currentTime + 0.3 = 0.3 (since mock currentTime = 0)
 */
const RAMP_END = 0.3

// ── Helper: get the last linearRampToValueAtTime call args for a gain param ──
function lastRampArgs(gain: ReturnType<typeof makeMockGain>) {
  const calls = gain.gain.linearRampToValueAtTime.mock.calls
  if (calls.length === 0) return null
  return calls[calls.length - 1] as [number, number]
}

// ---------------------------------------------------------------------------
// 1. setTier(1) — lead and arp gains must both ramp to 0
// ---------------------------------------------------------------------------

describe('setTier(1) — sparse tier-1 atmosphere', () => {
  it('ramps lead gain to 0', () => {
    const result = renderAndStart()
    act(() => { result.current.setTier(1) })
    const leadGain = registry.gains[3]
    const args = lastRampArgs(leadGain)
    expect(args).not.toBeNull()
    expect(args![0]).toBe(0)
    expect(args![1]).toBeCloseTo(RAMP_END, 5)
  })

  it('ramps arp gain to 0', () => {
    const result = renderAndStart()
    act(() => { result.current.setTier(1) })
    const arpGain = registry.gains[4]
    const args = lastRampArgs(arpGain)
    expect(args).not.toBeNull()
    expect(args![0]).toBe(0)
    expect(args![1]).toBeCloseTo(RAMP_END, 5)
  })

  it('ramps bass gain to 0.18 at tier 1', () => {
    const result = renderAndStart()
    act(() => { result.current.setTier(1) })
    const bassGain = registry.gains[1]
    const args = lastRampArgs(bassGain)
    expect(args).not.toBeNull()
    expect(args![0]).toBe(0.18)
  })

  it('ramps pad gain to 0.04 at tier 1', () => {
    const result = renderAndStart()
    act(() => { result.current.setTier(1) })
    const padGain = registry.gains[2]
    const args = lastRampArgs(padGain)
    expect(args).not.toBeNull()
    expect(args![0]).toBe(0.04)
  })
})

// ---------------------------------------------------------------------------
// 2. setTier(2) — arp gain ramps to 0.10, lead stays at 0
// ---------------------------------------------------------------------------

describe('setTier(2) — arp joins at 0.10, lead remains silent', () => {
  it('ramps arp gain to 0.10', () => {
    const result = renderAndStart()
    act(() => { result.current.setTier(2) })
    const arpGain = registry.gains[4]
    const args = lastRampArgs(arpGain)
    expect(args).not.toBeNull()
    expect(args![0]).toBeCloseTo(0.10, 5)
    expect(args![1]).toBeCloseTo(RAMP_END, 5)
  })

  it('ramps lead gain to 0 at tier 2 (lead not yet active)', () => {
    const result = renderAndStart()
    act(() => { result.current.setTier(2) })
    const leadGain = registry.gains[3]
    const args = lastRampArgs(leadGain)
    expect(args).not.toBeNull()
    expect(args![0]).toBe(0)
  })

  it('ramps pad gain to 0.06 at tier 2', () => {
    const result = renderAndStart()
    act(() => { result.current.setTier(2) })
    const padGain = registry.gains[2]
    const args = lastRampArgs(padGain)
    expect(args).not.toBeNull()
    expect(args![0]).toBe(0.06)
  })
})

// ---------------------------------------------------------------------------
// 3. setTier(3) — lead gain ramps to 0.08, arp stays 0.10
// ---------------------------------------------------------------------------

describe('setTier(3) — lead enters at 0.08', () => {
  it('ramps lead gain to 0.08', () => {
    const result = renderAndStart()
    act(() => { result.current.setTier(3) })
    const leadGain = registry.gains[3]
    const args = lastRampArgs(leadGain)
    expect(args).not.toBeNull()
    expect(args![0]).toBeCloseTo(0.08, 5)
    expect(args![1]).toBeCloseTo(RAMP_END, 5)
  })

  it('ramps arp gain to 0.10 at tier 3 (unchanged from tier 2)', () => {
    const result = renderAndStart()
    act(() => { result.current.setTier(3) })
    const arpGain = registry.gains[4]
    const args = lastRampArgs(arpGain)
    expect(args).not.toBeNull()
    expect(args![0]).toBeCloseTo(0.10, 5)
  })
})

// ---------------------------------------------------------------------------
// 4. setTier(4) — lead ramps to 0.10, arp ramps to 0.12, bass ramps to 0.22
// ---------------------------------------------------------------------------

describe('setTier(4) — dense synthwave at maximum tier', () => {
  it('ramps lead gain to 0.10', () => {
    const result = renderAndStart()
    act(() => { result.current.setTier(4) })
    const leadGain = registry.gains[3]
    const args = lastRampArgs(leadGain)
    expect(args).not.toBeNull()
    expect(args![0]).toBeCloseTo(0.10, 5)
    expect(args![1]).toBeCloseTo(RAMP_END, 5)
  })

  it('ramps arp gain to 0.12', () => {
    const result = renderAndStart()
    act(() => { result.current.setTier(4) })
    const arpGain = registry.gains[4]
    const args = lastRampArgs(arpGain)
    expect(args).not.toBeNull()
    expect(args![0]).toBeCloseTo(0.12, 5)
    expect(args![1]).toBeCloseTo(RAMP_END, 5)
  })

  it('ramps bass gain to 0.22 at tier 4', () => {
    const result = renderAndStart()
    act(() => { result.current.setTier(4) })
    const bassGain = registry.gains[1]
    const args = lastRampArgs(bassGain)
    expect(args).not.toBeNull()
    expect(args![0]).toBeCloseTo(0.22, 5)
  })

  it('ramps pad gain to 0.06 at tier 4', () => {
    const result = renderAndStart()
    act(() => { result.current.setTier(4) })
    const padGain = registry.gains[2]
    const args = lastRampArgs(padGain)
    expect(args).not.toBeNull()
    expect(args![0]).toBeCloseTo(0.06, 5)
  })
})

// ---------------------------------------------------------------------------
// 5. Arpeggio scheduler — starts at tier 2, stops on stopAudio
// ---------------------------------------------------------------------------

describe('arpeggio scheduler lifecycle', () => {
  it('setTier(2) starts the arpeggio interval (arpeggioTimeoutRef is non-null after)', () => {
    // We verify the scheduler was started by checking that setInterval was called.
    // vi.useFakeTimers() replaces setInterval with a spy we can inspect.
    const setIntervalSpy = vi.spyOn(globalThis, 'setInterval')

    const result = renderAndStart()
    act(() => { result.current.setTier(2) })

    // setInterval should have been called at least once for the arpeggio
    expect(setIntervalSpy).toHaveBeenCalled()

    setIntervalSpy.mockRestore()
  })

  it('setTier(1) does NOT start the arpeggio scheduler', () => {
    const setIntervalSpy = vi.spyOn(globalThis, 'setInterval')
    const clearIntervalSpy = vi.spyOn(globalThis, 'clearInterval')

    const result = renderAndStart()
    // setInterval may be called during startAudio for other reasons; record count after start
    const countAfterStart = setIntervalSpy.mock.calls.length

    act(() => { result.current.setTier(1) })

    // No new setInterval calls for arpeggio at tier 1
    expect(setIntervalSpy.mock.calls.length).toBe(countAfterStart)

    setIntervalSpy.mockRestore()
    clearIntervalSpy.mockRestore()
  })

  it('stopAudio cancels the arpeggio scheduler started by setTier(2)', () => {
    const clearIntervalSpy = vi.spyOn(globalThis, 'clearInterval')

    const result = renderAndStart()
    act(() => { result.current.setTier(2) })

    // Now stop — this should clear the arpeggio interval
    act(() => { result.current.stopAudio() })

    expect(clearIntervalSpy).toHaveBeenCalled()

    clearIntervalSpy.mockRestore()
  })

  it('arpeggio scheduler does not restart if already running when setTier(3) is called', () => {
    const setIntervalSpy = vi.spyOn(globalThis, 'setInterval')

    const result = renderAndStart()
    act(() => { result.current.setTier(2) })
    const countAfterTier2 = setIntervalSpy.mock.calls.length

    // setTier(3) should NOT call setInterval again — scheduler already running
    act(() => { result.current.setTier(3) })
    expect(setIntervalSpy.mock.calls.length).toBe(countAfterTier2)

    setIntervalSpy.mockRestore()
  })

  it('arpeggio fires its tick callback when the interval elapses', () => {
    const result = renderAndStart()
    act(() => { result.current.setTier(2) })

    // Advance fake timers by one 16th-note interval at BPM 100:
    // intervalMs = 60000 / (100 * 4) = 150ms
    act(() => { vi.advanceTimersByTime(150) })

    // The tick sets arpOsc.frequency via setValueAtTime — verify it was called
    const arpOsc = registry.oscillators[3]
    expect(arpOsc.frequency.setValueAtTime).toHaveBeenCalled()
  })
})

// ---------------------------------------------------------------------------
// 6. setFilterCutoff — speed-to-Hz mapping correctness
// ---------------------------------------------------------------------------

describe('setFilterCutoff — speed-to-Hz mapping', () => {
  /**
   * The App.tsx formula:
   *   cutoff = 400 + (speed - INITIAL_SPEED) / (MAX_SPEED - INITIAL_SPEED) * (8000 - 400)
   *   clamped: Math.max(400, Math.min(8000, cutoff))
   *
   * INITIAL_SPEED = 12, MAX_SPEED = 45
   */

  function speedToHz(speed: number): number {
    const cutoff = 400 + (speed - INITIAL_SPEED) / (MAX_SPEED - INITIAL_SPEED) * (8000 - 400)
    return Math.max(400, Math.min(8000, cutoff))
  }

  it('setFilterCutoff is callable and sets filter.frequency.value directly', () => {
    const result = renderAndStart()
    act(() => { result.current.setFilterCutoff(1200) })
    expect(registry.filters[0].frequency.value).toBe(1200)
  })

  it('speed at INITIAL_SPEED maps to 400 Hz (low cutoff = muffled)', () => {
    const hz = speedToHz(INITIAL_SPEED)
    expect(hz).toBeCloseTo(400, 1)
    const result = renderAndStart()
    act(() => { result.current.setFilterCutoff(hz) })
    expect(registry.filters[0].frequency.value).toBeCloseTo(400, 1)
  })

  it('speed at MAX_SPEED maps to 8000 Hz (high cutoff = bright)', () => {
    const hz = speedToHz(MAX_SPEED)
    expect(hz).toBeCloseTo(8000, 1)
    const result = renderAndStart()
    act(() => { result.current.setFilterCutoff(hz) })
    expect(registry.filters[0].frequency.value).toBeCloseTo(8000, 1)
  })

  it('speed below INITIAL_SPEED clamps to 400 Hz floor', () => {
    const hz = speedToHz(0)
    expect(hz).toBe(400)
  })

  it('speed above MAX_SPEED clamps to 8000 Hz ceiling', () => {
    const hz = speedToHz(MAX_SPEED + 10)
    expect(hz).toBe(8000)
  })

  it('mid-range speed maps into the 400–8000 Hz band', () => {
    // Speed midpoint between INITIAL and MAX
    const midSpeed = (INITIAL_SPEED + MAX_SPEED) / 2
    const hz = speedToHz(midSpeed)
    expect(hz).toBeGreaterThan(400)
    expect(hz).toBeLessThan(8000)
  })

  it('filter cutoff increases monotonically with speed', () => {
    const speeds = [12, 15, 20, 25, 30, 37, 45]
    const hzValues = speeds.map(speedToHz)
    for (let i = 1; i < hzValues.length; i++) {
      expect(hzValues[i]).toBeGreaterThanOrEqual(hzValues[i - 1])
    }
  })

  it('setFilterCutoff is a no-op before startAudio — does not throw', () => {
    const { result } = renderHook(() => useAudio())
    expect(() => {
      act(() => { result.current.setFilterCutoff(2000) })
    }).not.toThrow()
  })
})
