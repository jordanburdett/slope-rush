import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useAudio, type AudioControls } from '../useAudio'

// ── Web Audio API mock ────────────────────────────────────────────────────────

// Mocks are plain objects with vi.fn() methods so Vitest can track calls.
// We use a module-level registry so individual tests can access created nodes.

interface MockFreqParam {
  value: number
  setValueAtTime: ReturnType<typeof vi.fn>
  setTargetAtTime: ReturnType<typeof vi.fn>
  exponentialRampToValueAtTime: ReturnType<typeof vi.fn>
  linearRampToValueAtTime: ReturnType<typeof vi.fn>
}

function makeMockFreqParam(initial = 0): MockFreqParam {
  return {
    value: initial,
    setValueAtTime: vi.fn(),
    setTargetAtTime: vi.fn(),
    exponentialRampToValueAtTime: vi.fn(),
    linearRampToValueAtTime: vi.fn(),
  }
}

function makeMockGainParam(initial = 1) {
  return {
    value: initial,
    setValueAtTime: vi.fn(),
    setTargetAtTime: vi.fn(),
    exponentialRampToValueAtTime: vi.fn(),
    linearRampToValueAtTime: vi.fn(),
  }
}

// Per-test registry — reset in beforeEach
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

// Patch global AudioContext before tests
beforeEach(() => {
  registry.oscillators = []
  registry.gains = []
  registry.filters = []
  registry.bufferSources = []
  registry.ctxInstances = []

  // AudioContext is used as `new AudioContext()` — we assign a real constructor-like function
  const FakeAudioContext = function (this: unknown) {
    const ctx = makeMockCtx()
    // Copy all methods/props onto `this` so the hook gets a proper instance
    Object.assign(this as object, ctx)
  } as unknown as typeof AudioContext

  vi.stubGlobal('AudioContext', FakeAudioContext)
  vi.useFakeTimers()
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

// ── Helper ───────────────────────────────────────────────────────────────────

function renderAndStart() {
  const { result } = renderHook<AudioControls, void>(() => useAudio())
  act(() => {
    result.current.startAudio()
  })
  return result
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe('AudioControls interface', () => {
  it('exports setFilterCutoff on the returned object', () => {
    const { result } = renderHook(() => useAudio())
    expect(typeof result.current.setFilterCutoff).toBe('function')
  })

  it('exports all six expected controls', () => {
    const { result } = renderHook(() => useAudio())
    const keys = Object.keys(result.current)
    expect(keys).toContain('startAudio')
    expect(keys).toContain('stopAudio')
    expect(keys).toContain('triggerDeath')
    expect(keys).toContain('triggerTierUp')
    expect(keys).toContain('setTier')
    expect(keys).toContain('setFilterCutoff')
  })
})

describe('startAudio — 4-voice audio graph setup', () => {
  it('creates an AudioContext', () => {
    renderAndStart()
    expect(registry.ctxInstances).toHaveLength(1)
  })

  it('creates exactly 4 oscillator nodes (bass, pad, lead, arp)', () => {
    renderAndStart()
    expect(registry.oscillators).toHaveLength(4)
  })

  it('oscillators have the correct waveform types in order: sawtooth, sine, square, triangle', () => {
    renderAndStart()
    const [bassOsc, padOsc, leadOsc, arpOsc] = registry.oscillators
    expect(bassOsc.type).toBe('sawtooth')
    expect(padOsc.type).toBe('sine')
    expect(leadOsc.type).toBe('square')
    expect(arpOsc.type).toBe('triangle')
  })

  it('starts all 4 oscillators', () => {
    renderAndStart()
    for (const osc of registry.oscillators) {
      expect(osc.start).toHaveBeenCalledTimes(1)
    }
  })

  it('creates exactly one biquad lowpass filter for the master bus', () => {
    renderAndStart()
    expect(registry.filters).toHaveLength(1)
    expect(registry.filters[0].type).toBe('lowpass')
  })

  it('creates 5 gain nodes (masterGain + 4 voice gains)', () => {
    renderAndStart()
    // masterGain + bassGain + padGain + leadGain + arpGain = 5
    expect(registry.gains).toHaveLength(5)
  })

  it('initialises bass frequency to tier-1 root (80 Hz)', () => {
    renderAndStart()
    const [bassOsc] = registry.oscillators
    expect(bassOsc.frequency.setValueAtTime).toHaveBeenCalledWith(80, 0)
  })

  it('initialises pad frequency to root * 1.5 = 120 Hz', () => {
    renderAndStart()
    const [, padOsc] = registry.oscillators
    expect(padOsc.frequency.setValueAtTime).toHaveBeenCalledWith(80 * 1.5, 0)
  })

  it('initialises lead frequency to root * 2 = 160 Hz', () => {
    renderAndStart()
    const [, , leadOsc] = registry.oscillators
    expect(leadOsc.frequency.setValueAtTime).toHaveBeenCalledWith(80 * 2, 0)
  })

  it('initialises arp frequency to root (80 Hz)', () => {
    renderAndStart()
    const [, , , arpOsc] = registry.oscillators
    expect(arpOsc.frequency.setValueAtTime).toHaveBeenCalledWith(80, 0)
  })

  it('lead voice starts silent (gain 0)', () => {
    renderAndStart()
    // masterGain[0], bassGain[1], padGain[2], leadGain[3], arpGain[4]
    const leadGain = registry.gains[3]
    expect(leadGain.gain.setValueAtTime).toHaveBeenCalledWith(0.0, 0)
  })

  it('arp voice starts silent (gain 0)', () => {
    renderAndStart()
    const arpGain = registry.gains[4]
    expect(arpGain.gain.setValueAtTime).toHaveBeenCalledWith(0.0, 0)
  })

  it('master filter initial cutoff set to 400 Hz', () => {
    renderAndStart()
    const filter = registry.filters[0]
    expect(filter.frequency.setValueAtTime).toHaveBeenCalledWith(400, 0)
  })

  it('is idempotent — second call does not create another AudioContext', () => {
    const result = renderAndStart()
    act(() => {
      result.current.startAudio()
    })
    expect(registry.ctxInstances).toHaveLength(1)
  })
})

describe('setTier — frequency updates on all 4 voices', () => {
  const TIER_FREQ: Record<number, number> = { 1: 80, 2: 120, 3: 160, 4: 220 }

  it.each([1, 2, 3, 4] as const)(
    'tier %i: ramps bass to TIER_FREQ[%i]',
    (tier) => {
      const result = renderAndStart()
      act(() => { result.current.setTier(tier) })
      const [bassOsc] = registry.oscillators
      expect(bassOsc.frequency.setTargetAtTime).toHaveBeenCalledWith(TIER_FREQ[tier], 0, 0.1)
    },
  )

  it.each([1, 2, 3, 4] as const)(
    'tier %i: ramps pad to TIER_FREQ[%i] * 1.5',
    (tier) => {
      const result = renderAndStart()
      act(() => { result.current.setTier(tier) })
      const [, padOsc] = registry.oscillators
      expect(padOsc.frequency.setTargetAtTime).toHaveBeenCalledWith(TIER_FREQ[tier] * 1.5, 0, 0.1)
    },
  )

  it.each([1, 2, 3, 4] as const)(
    'tier %i: ramps lead to TIER_FREQ[%i] * 2',
    (tier) => {
      const result = renderAndStart()
      act(() => { result.current.setTier(tier) })
      const [, , leadOsc] = registry.oscillators
      expect(leadOsc.frequency.setTargetAtTime).toHaveBeenCalledWith(TIER_FREQ[tier] * 2, 0, 0.1)
    },
  )

  it.each([1, 2, 3, 4] as const)(
    'tier %i: ramps arp to TIER_FREQ[%i]',
    (tier) => {
      const result = renderAndStart()
      act(() => { result.current.setTier(tier) })
      const [, , , arpOsc] = registry.oscillators
      expect(arpOsc.frequency.setTargetAtTime).toHaveBeenCalledWith(TIER_FREQ[tier], 0, 0.1)
    },
  )

  it('is a no-op before startAudio is called — does not throw', () => {
    const { result } = renderHook(() => useAudio())
    expect(() => {
      act(() => { result.current.setTier(2) })
    }).not.toThrow()
    expect(registry.ctxInstances).toHaveLength(0)
  })
})

describe('setFilterCutoff', () => {
  it('sets filter.frequency.value directly (no ramp)', () => {
    const result = renderAndStart()
    act(() => { result.current.setFilterCutoff(800) })
    expect(registry.filters[0].frequency.value).toBe(800)
  })

  it('accepts the full audible range', () => {
    const result = renderAndStart()
    const testValues = [20, 200, 1000, 8000, 20000]
    for (const hz of testValues) {
      act(() => { result.current.setFilterCutoff(hz) })
      expect(registry.filters[0].frequency.value).toBe(hz)
    }
  })

  it('is a no-op before startAudio is called — does not throw', () => {
    const { result } = renderHook(() => useAudio())
    expect(() => {
      act(() => { result.current.setFilterCutoff(1200) })
    }).not.toThrow()
  })

  it('overwrites the previous value on successive calls', () => {
    const result = renderAndStart()
    act(() => {
      result.current.setFilterCutoff(400)
      result.current.setFilterCutoff(2000)
    })
    expect(registry.filters[0].frequency.value).toBe(2000)
  })
})

describe('stopAudio — master gain ramp and context teardown', () => {
  it('ramps master gain to 0 via setTargetAtTime with timeConstant 0.15', () => {
    const result = renderAndStart()
    act(() => { result.current.stopAudio() })
    // masterGain is gains[0]
    const masterGain = registry.gains[0]
    expect(masterGain.gain.setTargetAtTime).toHaveBeenCalledWith(0, 0, 0.15)
  })

  it('closes the AudioContext after the 600ms fade timeout', () => {
    const result = renderAndStart()
    // Capture the ctx instance created during startAudio
    const ctx = registry.ctxInstances[0]
    act(() => { result.current.stopAudio() })
    expect(ctx.close).not.toHaveBeenCalled()
    act(() => { vi.advanceTimersByTime(601) })
    expect(ctx.close).toHaveBeenCalledTimes(1)
  })

  it('stops all 4 oscillators after the timeout', () => {
    const result = renderAndStart()
    const oscs = [...registry.oscillators]
    act(() => { result.current.stopAudio() })
    act(() => { vi.advanceTimersByTime(601) })
    for (const osc of oscs) {
      expect(osc.stop).toHaveBeenCalledTimes(1)
    }
  })

  it('is a no-op before startAudio is called — does not throw', () => {
    const { result } = renderHook(() => useAudio())
    expect(() => {
      act(() => { result.current.stopAudio() })
    }).not.toThrow()
    expect(registry.ctxInstances).toHaveLength(0)
  })
})

describe('triggerDeath — white noise burst', () => {
  it('creates a buffer source and starts it immediately', () => {
    const result = renderAndStart()
    act(() => { result.current.triggerDeath() })
    expect(registry.bufferSources).toHaveLength(1)
    expect(registry.bufferSources[0].start).toHaveBeenCalledTimes(1)
  })

  it('routes the burst direct to destination (bypass master gain)', () => {
    const result = renderAndStart()
    act(() => { result.current.triggerDeath() })
    // The death gain node (created after the 5 voice gains) should connect to destination
    const deathGain = registry.gains[5] // index 5 = first post-startAudio gain
    expect(deathGain).toBeDefined()
    expect(deathGain.connect).toHaveBeenCalled()
  })

  it('is a no-op before startAudio is called — does not throw', () => {
    const { result } = renderHook(() => useAudio())
    expect(() => {
      act(() => { result.current.triggerDeath() })
    }).not.toThrow()
  })
})

describe('triggerTierUp — two-note chime', () => {
  it('creates exactly 2 short oscillators for the chime', () => {
    const result = renderAndStart()
    const oscCountBefore = registry.oscillators.length // 4
    act(() => { result.current.triggerTierUp() })
    expect(registry.oscillators.length).toBe(oscCountBefore + 2)
  })

  it('chime oscillators are both sine waves', () => {
    const result = renderAndStart()
    act(() => { result.current.triggerTierUp() })
    const chimeOscs = registry.oscillators.slice(4) // indices 4 and 5
    for (const osc of chimeOscs) {
      expect(osc.type).toBe('sine')
    }
  })

  it('is a no-op before startAudio is called — does not throw', () => {
    const { result } = renderHook(() => useAudio())
    expect(() => {
      act(() => { result.current.triggerTierUp() })
    }).not.toThrow()
  })
})
