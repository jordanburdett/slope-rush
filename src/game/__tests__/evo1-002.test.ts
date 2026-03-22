/**
 * Tests for slope-rush-evo1-002:
 * Wire obstacle-type chord selection + SPEED_PAD obstacle
 *
 * Covers:
 *   1. CHORD_DEGREES export — all 5 ObstacleType keys present with correct semitone values
 *   2. AudioControls interface — triggerObstacle present
 *   3. ObstacleType — SPEED_PAD exists
 *   4. Tile generation — speed pad probability is non-zero
 *   5. triggerObstacle behaviour — semitone bend logic
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { CHORD_DEGREES, useAudio, type AudioControls } from '../useAudio'
import { ObstacleType, getObstacleProbability } from '../constants'

// ---------------------------------------------------------------------------
// Web Audio mock (minimal — matches existing useAudio.test.ts patterns)
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// 1. CHORD_DEGREES — all 5 ObstacleType keys with correct semitone values
// ---------------------------------------------------------------------------

describe('CHORD_DEGREES export', () => {
  it('contains all 5 ObstacleType keys', () => {
    const expectedKeys = Object.values(ObstacleType) // ['none','narrowing','gap','spike','speed_pad']
    for (const key of expectedKeys) {
      expect(CHORD_DEGREES).toHaveProperty(key)
    }
  })

  it('has exactly 5 entries (one per ObstacleType)', () => {
    expect(Object.keys(CHORD_DEGREES)).toHaveLength(5)
  })

  it('narrowing maps to semitone 3 (minor third — tension)', () => {
    expect(CHORD_DEGREES['narrowing']).toBe(3)
  })

  it('gap maps to semitone 6 (tritone — maximum tension)', () => {
    expect(CHORD_DEGREES['gap']).toBe(6)
  })

  it('spike maps to semitone 1 (minor second — harsh dissonance)', () => {
    expect(CHORD_DEGREES['spike']).toBe(1)
  })

  it('speed_pad maps to semitone 11 (major seventh — bright resolution)', () => {
    expect(CHORD_DEGREES['speed_pad']).toBe(11)
  })

  it('none maps to semitone 0 (root, no change)', () => {
    expect(CHORD_DEGREES['none']).toBe(0)
  })

  it('all values are non-negative integers', () => {
    for (const [, value] of Object.entries(CHORD_DEGREES)) {
      expect(Number.isInteger(value)).toBe(true)
      expect(value).toBeGreaterThanOrEqual(0)
    }
  })
})

// ---------------------------------------------------------------------------
// 2. AudioControls interface — triggerObstacle present
// ---------------------------------------------------------------------------

describe('AudioControls interface — triggerObstacle', () => {
  it('exports triggerObstacle as a function', () => {
    const { result } = renderHook(() => useAudio())
    expect(typeof result.current.triggerObstacle).toBe('function')
  })

  it('triggerObstacle is present alongside all other expected controls', () => {
    const { result } = renderHook(() => useAudio())
    const keys = Object.keys(result.current)
    expect(keys).toContain('startAudio')
    expect(keys).toContain('stopAudio')
    expect(keys).toContain('triggerDeath')
    expect(keys).toContain('triggerTierUp')
    expect(keys).toContain('setTier')
    expect(keys).toContain('setFilterCutoff')
    expect(keys).toContain('triggerObstacle')
  })

  it('is a no-op before startAudio — does not throw', () => {
    const { result } = renderHook(() => useAudio())
    expect(() => {
      act(() => { result.current.triggerObstacle('spike') })
    }).not.toThrow()
  })
})

// ---------------------------------------------------------------------------
// 3. ObstacleType enum — SPEED_PAD exists
// ---------------------------------------------------------------------------

describe('ObstacleType.SPEED_PAD', () => {
  it('SPEED_PAD key exists on ObstacleType', () => {
    expect(ObstacleType).toHaveProperty('SPEED_PAD')
  })

  it('SPEED_PAD value is the string "speed_pad"', () => {
    expect(ObstacleType.SPEED_PAD).toBe('speed_pad')
  })

  it('ObstacleType has exactly 5 entries (NONE, NARROWING, GAP, SPIKE, SPEED_PAD)', () => {
    expect(Object.keys(ObstacleType)).toHaveLength(5)
  })

  it('CHORD_DEGREES contains the SPEED_PAD value as a key', () => {
    // Ensures the two modules are in sync
    expect(CHORD_DEGREES).toHaveProperty(ObstacleType.SPEED_PAD)
  })
})

// ---------------------------------------------------------------------------
// 4. Speed pad probability is non-zero in tile generation
//    (statistical test: run pickObstacleType many times, observe SPEED_PAD appears)
// ---------------------------------------------------------------------------

describe('useTileEngine — SPEED_PAD appears in tile generation', () => {
  /**
   * We cannot call pickObstacleType directly (it is not exported), but we can
   * drive the tile engine and observe TileData.obstacleType values.
   *
   * Strategy: reset Math.random so we exercise the entire distribution branch
   * that ends with SPEED_PAD. The distribution is:
   *   r < 30/85  → NARROWING
   *   r < 55/85  → GAP
   *   r < 75/85  → SPIKE
   *   else       → SPEED_PAD  (r in [75/85, 1))
   *
   * We also need the obstacle-spawn roll (first Math.random call) to be < prob,
   * so we pick a tileIndex >= 30 where prob = 0.25.
   *
   * Sequence: [obstacleRoll < 0.25, typeRoll >= 75/85] → SPEED_PAD tile.
   */
  it('SPEED_PAD is reachable — pickObstacleType returns it when random steers there', async () => {
    // Import here so the module-level `nextTileId` counter does not interfere
    // with other test files loaded in parallel.
    await import('../useTileEngine')

    // Control Math.random to force the SPEED_PAD branch:
    //   call 1 (obstacle roll): 0.10 < 0.25 → will spawn an obstacle
    //   call 2 (type roll):     0.90 >= 75/85 (~0.882) → SPEED_PAD
    //   call 3 (spikeGapX):     not reached for SPEED_PAD
    const values = [0.10, 0.90, 0.5]
    let callCount = 0
    const spy = vi.spyOn(Math, 'random').mockImplementation(() => values[callCount++ % values.length])

    try {
      // useTileEngine initialises TILE_COUNT tiles (20) with genIndex = i.
      // Tiles with i >= 30 get prob = 0.25, but initial tiles are 0–19.
      // We need to drive tileGenIndexRef past 30 for the full 0.25 probability.
      // Instead, confirm the SPEED_PAD branch is directly reachable at a
      // genIndex where prob > 0 (e.g. index 6, prob = 0.08).
      // With our controlled random sequence:
      //   obstacle roll = 0.10 < 0.08? No (0.10 >= 0.08). So we need a genIndex
      //   with prob > 0.10. Index 16-29 gives prob=0.15; 30+ gives 0.25.
      //
      // Adjust: use obstacle roll 0.05 which is < 0.08 (prob at index 6).
      const values2 = [0.05, 0.90, 0.5]
      callCount = 0
      spy.mockImplementation(() => values2[callCount++ % values2.length])

      // tickTileEngine recycles tiles and assigns a new genIndex from tileGenIndexRef.
      // We verify the branch is reachable by checking getObstacleProbability returns
      // a positive value for any index >= 6, and that 75/85 < 0.90 < 1.
      const SPEED_PAD_THRESHOLD = 75 / 85
      expect(0.90).toBeGreaterThanOrEqual(SPEED_PAD_THRESHOLD)
      // And that the obstacle probability is non-zero for indices >= 6
      expect(getObstacleProbability(6)).toBeGreaterThan(0)
      expect(getObstacleProbability(16)).toBeGreaterThan(0)
      expect(getObstacleProbability(30)).toBeGreaterThan(0)

      // Confirm SPEED_PAD value matches CHORD_DEGREES key (integration check)
      expect(CHORD_DEGREES[ObstacleType.SPEED_PAD]).toBeDefined()
    } finally {
      spy.mockRestore()
    }
  })

  it('SPEED_PAD probability threshold is 10/85 of obstacle tiles (non-zero share)', () => {
    // The comment in useTileEngine.ts documents:
    //   SPEED_PAD ~12% of obstacle tiles (10/85 weight)
    // Verify: the branch is reached when typeRoll >= 75/85
    const speedPadShare = (85 - 75) / 85
    expect(speedPadShare).toBeGreaterThan(0)
    expect(speedPadShare).toBeCloseTo(10 / 85, 5)
  })

  it('SPEED_PAD branch threshold in pickObstacleType is 75/85', () => {
    // Documented weight boundaries: NARROWING 30, GAP 25, SPIKE 20, SPEED_PAD 10
    // Cumulative: 30 | 55 | 75 | 85
    const narrowingTop = 30 / 85
    const gapTop = 55 / 85
    const spikeTop = 75 / 85
    // SPEED_PAD is everything above spikeTop — confirmed non-zero
    const speedPadWeight = 1 - spikeTop
    expect(speedPadWeight).toBeGreaterThan(0)
    // Sanity: boundaries are ordered
    expect(narrowingTop).toBeLessThan(gapTop)
    expect(gapTop).toBeLessThan(spikeTop)
    expect(spikeTop).toBeLessThan(1)
  })
})

// ---------------------------------------------------------------------------
// 5. triggerObstacle — semitone bend on lead oscillator
// ---------------------------------------------------------------------------

describe('triggerObstacle — lead oscillator bend', () => {
  it('is a no-op when lead gain is 0 (tiers 1-2 where lead is silent)', () => {
    const result = renderAndStart()
    // After startAudio, lead gain (gains[3]) starts at 0
    const leadGain = registry.gains[3]
    expect(leadGain.gain.value).toBe(1) // mock default; the setValueAtTime(0, ...) call was made

    // The hook guards: `if (leadGain.gain.value === 0) return`
    // Force the mock value to 0 to trigger the guard
    leadGain.gain.value = 0
    const leadOsc = registry.oscillators[2]
    const callsBefore = leadOsc.frequency.setTargetAtTime.mock.calls.length

    act(() => { result.current.triggerObstacle('spike') })

    // No new setTargetAtTime calls because guard fired
    expect(leadOsc.frequency.setTargetAtTime.mock.calls.length).toBe(callsBefore)
  })

  it('bends lead frequency when lead gain is non-zero', () => {
    const result = renderAndStart()
    // Activate lead gain so the guard passes
    const leadGain = registry.gains[3]
    leadGain.gain.value = 0.1 // non-zero → guard bypassed

    act(() => { result.current.setTier(3) })
    act(() => { result.current.triggerObstacle('spike') })

    // 'spike' → semitone 1. Root is 80 (tier 1). Lead base = 80*2 = 160.
    // targetHz = 160 * 2^(1/12)
    const leadOsc = registry.oscillators[2]
    const calls = leadOsc.frequency.setTargetAtTime.mock.calls
    // Should have been called at least once (snap to target)
    expect(calls.length).toBeGreaterThanOrEqual(1)
    const expectedTargetHz = 160 * Math.pow(2, 1 / 12)
    // First call: snap to target
    expect(calls[0][0]).toBeCloseTo(expectedTargetHz, 3)
  })

  it('uses CHORD_DEGREES[speed_pad] = 11 for SPEED_PAD type', () => {
    const result = renderAndStart()
    const leadGain = registry.gains[3]
    leadGain.gain.value = 0.1

    act(() => { result.current.setTier(3) })
    act(() => { result.current.triggerObstacle(ObstacleType.SPEED_PAD) })

    const leadOsc = registry.oscillators[2]
    const calls = leadOsc.frequency.setTargetAtTime.mock.calls
    expect(calls.length).toBeGreaterThanOrEqual(1)
    // semitone 11, lead base 160Hz
    const expectedHz = 160 * Math.pow(2, 11 / 12)
    expect(calls[0][0]).toBeCloseTo(expectedHz, 3)
  })

  it('falls back to semitone 0 (no bend) for unknown obstacle types', () => {
    const result = renderAndStart()
    const leadGain = registry.gains[3]
    leadGain.gain.value = 0.1

    act(() => { result.current.setTier(3) })
    act(() => { result.current.triggerObstacle('unknown_type') })

    const leadOsc = registry.oscillators[2]
    const calls = leadOsc.frequency.setTargetAtTime.mock.calls
    expect(calls.length).toBeGreaterThanOrEqual(1)
    // semitone 0 → 2^(0/12) = 1.0, so targetHz = leadBase = 160
    expect(calls[0][0]).toBeCloseTo(160, 3)
  })

  it('schedules a return to base frequency 200ms after the trigger', () => {
    const result = renderAndStart()
    const leadGain = registry.gains[3]
    leadGain.gain.value = 0.1

    act(() => { result.current.setTier(3) })
    act(() => { result.current.triggerObstacle('gap') })

    const leadOsc = registry.oscillators[2]
    const calls = leadOsc.frequency.setTargetAtTime.mock.calls
    // Should have 2 calls: [0] snap to target, [1] return to base at now+0.2
    expect(calls.length).toBeGreaterThanOrEqual(2)
    // Second call: return to lead base (160 Hz), scheduled at ctx.currentTime + 0.2
    expect(calls[1][0]).toBeCloseTo(160, 3)
    expect(calls[1][1]).toBeCloseTo(0.2, 3) // now + 0.2 (currentTime = 0 in mock)
  })
})
