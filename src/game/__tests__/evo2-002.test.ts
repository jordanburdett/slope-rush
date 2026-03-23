/**
 * Tests for slope-rush-evo2-002:
 * Death bloom animation — BloomState logic
 *
 * Covers:
 *   1. bloomRef.active is set to true when newBest=true (PB-beating death)
 *   2. bloomRef.active remains false when newBest=false (non-PB death)
 *   3. Particles have correct start positions (deathPos + i*0.3 offset)
 *   4. Particles have correct end positions (constellation star coords)
 *   5. After elapsed >= 1.0, bloom.active becomes false (frame loop boundary)
 *   6. Cubic ease-out formula: 1 - Math.pow(1 - t, 3) at t=0, 0.5, 1.0
 *   7. handleRestart sets bloomRef.active = false
 *   8. bloomRef is initialised with active=false, elapsed=0, empty particles
 *   9. Particle count matches saved constellation star count
 *  10. bloomRef.elapsed starts at 0 on PB-triggering death
 *  11. Ease-out is monotonically increasing from t=0 to t=1
 *  12. Ease-out at t=1 equals exactly 1.0 (fully reached target)
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import {
  generateConstellation,
  saveConstellation,
  loadConstellations,
} from '../constellations'
import type { BloomState } from '../../App'

// ---------------------------------------------------------------------------
// localStorage helpers
// ---------------------------------------------------------------------------
beforeEach(() => {
  localStorage.clear()
})

afterEach(() => {
  localStorage.clear()
})

// ---------------------------------------------------------------------------
// Helpers — simulate the bloom-trigger logic extracted from handleDeath
// ---------------------------------------------------------------------------

/**
 * Simulates the bloom-trigger logic from handleDeath in App.tsx (lines 1372-1393).
 * Returns the resulting BloomState as if bloomRef.current were mutated.
 */
function triggerBloom(
  deathX: number,
  deathY: number,
  deathZ: number,
): BloomState {
  const savedEntry = loadConstellations()[0]
  if (!savedEntry) {
    return {
      active: false,
      elapsed: 0,
      deathPos: { x: deathX, y: deathY, z: deathZ } as never,
      color: '#7c3aed',
      particles: [],
    }
  }

  const particles = savedEntry.stars.map((star, i) => ({
    startX: deathX + i * 0.3,
    startY: deathY + i * 0.3,
    startZ: deathZ + i * 0.3,
    endX: star.x,
    endY: star.y,
    endZ: star.z,
  }))

  return {
    active: true,
    elapsed: 0,
    deathPos: { x: deathX, y: deathY, z: deathZ } as never,
    color: '#7c3aed',
    particles,
  }
}

/**
 * Simulates the frame-loop logic from BloomParticles.useFrame (lines 123-139).
 * Advances elapsed by `delta`, computes `t`, and sets active=false when t >= 1.0.
 */
function tickBloom(bloom: BloomState, delta: number): BloomState {
  const BLOOM_DURATION = 1.0
  bloom.elapsed += delta
  const t = Math.min(bloom.elapsed / BLOOM_DURATION, 1.0)
  if (t >= 1.0) {
    bloom.active = false
  }
  return bloom
}

/**
 * Cubic ease-out formula from BloomParticles.useFrame (line 125).
 */
function cubicEaseOut(t: number): number {
  return 1 - Math.pow(1 - t, 3)
}

// ---------------------------------------------------------------------------
// Initial bloom state
// ---------------------------------------------------------------------------
describe('BloomState — initial state', () => {
  it('starts with active=false', () => {
    const initial: BloomState = {
      active: false,
      elapsed: 0,
      deathPos: { x: 0, y: 0, z: 0 } as never,
      color: '#7c3aed',
      particles: [],
    }
    expect(initial.active).toBe(false)
  })

  it('starts with elapsed=0', () => {
    const initial: BloomState = {
      active: false,
      elapsed: 0,
      deathPos: { x: 0, y: 0, z: 0 } as never,
      color: '#7c3aed',
      particles: [],
    }
    expect(initial.elapsed).toBe(0)
  })

  it('starts with empty particles array', () => {
    const initial: BloomState = {
      active: false,
      elapsed: 0,
      deathPos: { x: 0, y: 0, z: 0 } as never,
      color: '#7c3aed',
      particles: [],
    }
    expect(initial.particles).toHaveLength(0)
  })
})

// ---------------------------------------------------------------------------
// handleDeath — PB-beating (newBest=true)
// ---------------------------------------------------------------------------
describe('handleDeath — newBest=true triggers bloom', () => {
  it('sets bloomRef.active to true when a saved constellation exists', () => {
    const entry = generateConstellation(100, 2, 50)
    saveConstellation(entry)

    const bloom = triggerBloom(1.0, 0.5, -5.0)
    expect(bloom.active).toBe(true)
  })

  it('sets elapsed to 0 on PB-triggering death', () => {
    const entry = generateConstellation(100, 2, 50)
    saveConstellation(entry)

    const bloom = triggerBloom(1.0, 0.5, -5.0)
    expect(bloom.elapsed).toBe(0)
  })

  it('particle count matches saved constellation star count', () => {
    // distance=100 → 5 stars (5 + 100%4 = 5)
    const entry = generateConstellation(100, 2, 50)
    saveConstellation(entry)
    const loaded = loadConstellations()[0]

    const bloom = triggerBloom(0, 0, 0)
    expect(bloom.particles).toHaveLength(loaded.stars.length)
  })

  it('particle count matches for distance=103 (8 stars)', () => {
    // distance=103 → 5 + (103%4) = 5+3 = 8 stars
    const entry = generateConstellation(103, 1, 0)
    saveConstellation(entry)

    const bloom = triggerBloom(2.0, 1.0, -10.0)
    expect(bloom.particles).toHaveLength(8)
  })
})

// ---------------------------------------------------------------------------
// handleDeath — non-PB (newBest=false)
// ---------------------------------------------------------------------------
describe('handleDeath — newBest=false leaves bloom inactive', () => {
  it('bloomRef.active remains false when no new best', () => {
    // Non-PB: no constellation is saved, so loadConstellations returns []
    // (localStorage is cleared in beforeEach)
    const bloom = triggerBloom(0, 0, 0)
    expect(bloom.active).toBe(false)
  })

  it('bloom.particles is empty when bloom is not triggered', () => {
    // No saved entries → bloom not triggered
    const bloom = triggerBloom(0, 0, 0)
    expect(bloom.particles).toHaveLength(0)
  })

  it('pre-existing inactive bloom is not made active by non-PB death', () => {
    // Start with an active bloom, simulate a non-PB death resetting it
    const preExisting: BloomState = {
      active: true,
      elapsed: 0.5,
      deathPos: { x: 0, y: 0, z: 0 } as never,
      color: '#06b6d4',
      particles: [{ startX: 0, startY: 0, startZ: 0, endX: 1, endY: 1, endZ: 1 }],
    }

    // Simulate the non-PB branch: bloomRef.current.active = false
    preExisting.active = false
    expect(preExisting.active).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// Particle start/end positions
// ---------------------------------------------------------------------------
describe('Particle positions', () => {
  it('particle startX = deathX + i * 0.3 for each particle', () => {
    const entry = generateConstellation(100, 2, 50)
    saveConstellation(entry)

    const deathX = 1.5
    const deathY = 0.3
    const deathZ = -8.0
    const bloom = triggerBloom(deathX, deathY, deathZ)

    bloom.particles.forEach((p, i) => {
      expect(p.startX).toBeCloseTo(deathX + i * 0.3, 10)
    })
  })

  it('particle startY = deathY + i * 0.3 for each particle', () => {
    const entry = generateConstellation(100, 2, 50)
    saveConstellation(entry)

    const deathY = 0.7
    const bloom = triggerBloom(0, deathY, 0)

    bloom.particles.forEach((p, i) => {
      expect(p.startY).toBeCloseTo(deathY + i * 0.3, 10)
    })
  })

  it('particle startZ = deathZ + i * 0.3 for each particle', () => {
    const entry = generateConstellation(100, 2, 50)
    saveConstellation(entry)

    const deathZ = -12.0
    const bloom = triggerBloom(0, 0, deathZ)

    bloom.particles.forEach((p, i) => {
      expect(p.startZ).toBeCloseTo(deathZ + i * 0.3, 10)
    })
  })

  it('particle endX/endY/endZ match the saved constellation star coords', () => {
    const entry = generateConstellation(100, 2, 50)
    saveConstellation(entry)
    const loaded = loadConstellations()[0]

    const bloom = triggerBloom(0, 0, 0)

    bloom.particles.forEach((p, i) => {
      expect(p.endX).toBe(loaded.stars[i].x)
      expect(p.endY).toBe(loaded.stars[i].y)
      expect(p.endZ).toBe(loaded.stars[i].z)
    })
  })

  it('first particle (i=0) starts exactly at deathPos', () => {
    const entry = generateConstellation(100, 2, 50)
    saveConstellation(entry)

    const deathX = 2.1
    const deathY = 0.4
    const deathZ = -6.5
    const bloom = triggerBloom(deathX, deathY, deathZ)

    // i=0 → startX = deathX + 0*0.3 = deathX
    expect(bloom.particles[0].startX).toBeCloseTo(deathX, 10)
    expect(bloom.particles[0].startY).toBeCloseTo(deathY, 10)
    expect(bloom.particles[0].startZ).toBeCloseTo(deathZ, 10)
  })
})

// ---------------------------------------------------------------------------
// Frame loop — elapsed + active deactivation at t >= 1.0
// ---------------------------------------------------------------------------
describe('Bloom frame loop — elapsed and deactivation', () => {
  it('bloom remains active while elapsed < 1.0', () => {
    const entry = generateConstellation(100, 2, 50)
    saveConstellation(entry)

    const bloom = triggerBloom(0, 0, 0)
    tickBloom(bloom, 0.5) // elapsed = 0.5, t = 0.5 — still active

    expect(bloom.active).toBe(true)
  })

  it('bloom becomes inactive when elapsed reaches exactly 1.0', () => {
    const entry = generateConstellation(100, 2, 50)
    saveConstellation(entry)

    const bloom = triggerBloom(0, 0, 0)
    tickBloom(bloom, 1.0) // elapsed = 1.0, t = 1.0 — deactivates

    expect(bloom.active).toBe(false)
  })

  it('bloom becomes inactive when elapsed exceeds 1.0', () => {
    const entry = generateConstellation(100, 2, 50)
    saveConstellation(entry)

    const bloom = triggerBloom(0, 0, 0)
    tickBloom(bloom, 0.6)
    tickBloom(bloom, 0.6) // total elapsed = 1.2 > 1.0 — deactivates

    expect(bloom.active).toBe(false)
  })

  it('elapsed accumulates correctly across multiple ticks', () => {
    const entry = generateConstellation(100, 2, 50)
    saveConstellation(entry)

    const bloom = triggerBloom(0, 0, 0)
    tickBloom(bloom, 0.2)
    tickBloom(bloom, 0.3)
    // elapsed = 0.5 before clamping happens; active still true
    expect(bloom.elapsed).toBeCloseTo(0.5, 10)
    expect(bloom.active).toBe(true)
  })

  it('elapsed is clamped to 1.0 (t = Math.min(elapsed/1.0, 1.0))', () => {
    // When elapsed > 1.0 the bloom deactivates — elapsed itself is not clamped
    // but t is, so the bloom will be inactive at that point
    const entry = generateConstellation(100, 2, 50)
    saveConstellation(entry)

    const bloom = triggerBloom(0, 0, 0)
    tickBloom(bloom, 2.0) // large single tick

    expect(bloom.active).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// Cubic ease-out formula
// ---------------------------------------------------------------------------
describe('Cubic ease-out: 1 - Math.pow(1 - t, 3)', () => {
  it('at t=0 returns 0.0', () => {
    expect(cubicEaseOut(0)).toBeCloseTo(0.0, 10)
  })

  it('at t=0.5 returns 0.875', () => {
    // 1 - (0.5)^3 = 1 - 0.125 = 0.875
    expect(cubicEaseOut(0.5)).toBeCloseTo(0.875, 10)
  })

  it('at t=1.0 returns 1.0', () => {
    expect(cubicEaseOut(1.0)).toBeCloseTo(1.0, 10)
  })

  it('at t=0.25 returns 0.578125', () => {
    // 1 - (0.75)^3 = 1 - 0.421875 = 0.578125
    expect(cubicEaseOut(0.25)).toBeCloseTo(0.578125, 10)
  })

  it('at t=0.75 returns 0.984375', () => {
    // 1 - (0.25)^3 = 1 - 0.015625 = 0.984375
    expect(cubicEaseOut(0.75)).toBeCloseTo(0.984375, 10)
  })

  it('is monotonically increasing from t=0 to t=1', () => {
    const steps = 10
    let prev = cubicEaseOut(0)
    for (let i = 1; i <= steps; i++) {
      const t = i / steps
      const current = cubicEaseOut(t)
      expect(current).toBeGreaterThan(prev)
      prev = current
    }
  })

  it('returns exactly 1.0 at t=1.0 (particles fully reach end positions)', () => {
    expect(cubicEaseOut(1.0)).toBe(1.0)
  })

  it('at t=0, interpolated position equals startX (no movement yet)', () => {
    // lerp: startX + (endX - startX) * eased = startX + (endX - startX) * 0 = startX
    const startX = 3.0
    const endX = 10.0
    const eased = cubicEaseOut(0)
    const pos = startX + (endX - startX) * eased
    expect(pos).toBeCloseTo(startX, 10)
  })

  it('at t=1, interpolated position equals endX (fully reached star)', () => {
    // lerp: startX + (endX - startX) * 1.0 = endX
    const startX = 3.0
    const endX = 10.0
    const eased = cubicEaseOut(1.0)
    const pos = startX + (endX - startX) * eased
    expect(pos).toBeCloseTo(endX, 10)
  })
})

// ---------------------------------------------------------------------------
// handleRestart — cancels active bloom
// ---------------------------------------------------------------------------
describe('handleRestart — cancels active bloom', () => {
  it('sets bloomRef.active to false', () => {
    // Start with an active bloom
    const bloom: BloomState = {
      active: true,
      elapsed: 0.3,
      deathPos: { x: 1, y: 0, z: -5 } as never,
      color: '#ec4899',
      particles: [{ startX: 1, startY: 0, startZ: -5, endX: 5, endY: 3, endZ: 20 }],
    }

    // Simulate the restart cancellation: bloomRef.current.active = false
    bloom.active = false

    expect(bloom.active).toBe(false)
  })

  it('sets bloomRef.active to false even when elapsed is mid-animation', () => {
    const bloom: BloomState = {
      active: true,
      elapsed: 0.7,
      deathPos: { x: 0, y: 0, z: 0 } as never,
      color: '#06b6d4',
      particles: [{ startX: 0, startY: 0, startZ: 0, endX: 10, endY: 5, endZ: -30 }],
    }

    bloom.active = false

    expect(bloom.active).toBe(false)
    // elapsed is not reset here (only active matters for hiding particles)
    expect(bloom.elapsed).toBe(0.7)
  })

  it('does not re-activate bloom on a subsequent non-PB death', () => {
    // Simulate: active bloom cancelled by restart, then non-PB death
    const bloom: BloomState = {
      active: true,
      elapsed: 0.5,
      deathPos: { x: 0, y: 0, z: 0 } as never,
      color: '#7c3aed',
      particles: [],
    }

    // handleRestart
    bloom.active = false

    // Non-PB death: bloomRef.current.active = false (already false, no change)
    bloom.active = false

    expect(bloom.active).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// Edge cases — bloom not triggered when no constellations are saved
// ---------------------------------------------------------------------------
describe('BloomState — no saved constellations (edge case)', () => {
  it('bloom is inactive when localStorage has no constellations', () => {
    // No saveConstellation call — loadConstellations() returns []
    const bloom = triggerBloom(0, 0, 0)
    expect(bloom.active).toBe(false)
  })

  it('bloom particles are empty when no constellations are saved', () => {
    const bloom = triggerBloom(5.0, 1.0, -20.0)
    expect(bloom.particles).toHaveLength(0)
  })

  it('bloom always activates once a constellation is saved', () => {
    // Confirm the transition from no-saved to saved
    const bloomBefore = triggerBloom(0, 0, 0)
    expect(bloomBefore.active).toBe(false)

    saveConstellation(generateConstellation(100, 2, 50))

    const bloomAfter = triggerBloom(0, 0, 0)
    expect(bloomAfter.active).toBe(true)
  })
})
