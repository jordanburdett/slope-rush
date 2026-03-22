/**
 * Unit tests for slope-rush pure game logic.
 * All tests run in jsdom/vitest — no R3F rendering involved.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import {
  TIER_COLORS,
  getSpeedTier,
  getTierColor,
  getObstacleProbability,
  BEST_KEY,
  BALL_RADIUS,
  SPIKE_RADIUS,
  INITIAL_SPEED,
  MAX_SPEED,
  SPEED_INCREMENT,
  SPEED_INTERVAL,
  type SpeedTier,
} from '../constants'
import { tickGameState, type GameStateRefs } from '../useGameState'
import { isBallOverGap, type ObstacleBox, type TileData } from '../useTileEngine'
import { ObstacleType } from '../constants'

// ---------------------------------------------------------------------------
// 1. Speed tier detection
// ---------------------------------------------------------------------------
describe('getSpeedTier', () => {
  it('returns tier 1 for speeds below 15', () => {
    expect(getSpeedTier(0)).toBe(1)
    expect(getSpeedTier(12)).toBe(1)
    expect(getSpeedTier(14.99)).toBe(1)
  })

  it('returns tier 1 for INITIAL_SPEED (12)', () => {
    expect(getSpeedTier(INITIAL_SPEED)).toBe(1)
  })

  it('returns tier 2 for speeds 15 to below 25', () => {
    expect(getSpeedTier(15)).toBe(2)
    expect(getSpeedTier(20)).toBe(2)
    expect(getSpeedTier(24.99)).toBe(2)
  })

  it('returns tier 3 for speeds 25 to below 37', () => {
    expect(getSpeedTier(25)).toBe(3)
    expect(getSpeedTier(30)).toBe(3)
    expect(getSpeedTier(36.99)).toBe(3)
  })

  it('returns tier 4 for speeds 37 and above', () => {
    expect(getSpeedTier(37)).toBe(4)
    expect(getSpeedTier(45)).toBe(4)
    expect(getSpeedTier(MAX_SPEED)).toBe(4)
  })
})

// ---------------------------------------------------------------------------
// 2. Tier color lookup
// ---------------------------------------------------------------------------
describe('getTierColor', () => {
  it('returns the correct hex color for each tier', () => {
    expect(getTierColor(1)).toBe('#7c3aed')
    expect(getTierColor(2)).toBe('#06b6d4')
    expect(getTierColor(3)).toBe('#ec4899')
    expect(getTierColor(4)).toBe('#ffffff')
  })

  it('each returned color matches TIER_COLORS directly', () => {
    const tiers: SpeedTier[] = [1, 2, 3, 4]
    for (const tier of tiers) {
      expect(getTierColor(tier)).toBe(TIER_COLORS[tier])
    }
  })
})

// ---------------------------------------------------------------------------
// 3. TIER_COLORS constant shape
// ---------------------------------------------------------------------------
describe('TIER_COLORS', () => {
  it('has exactly 4 entries', () => {
    expect(Object.keys(TIER_COLORS).length).toBe(4)
  })

  it('keys are 1, 2, 3, 4', () => {
    const keys = Object.keys(TIER_COLORS).map(Number).sort()
    expect(keys).toEqual([1, 2, 3, 4])
  })

  it('all values are non-empty strings starting with #', () => {
    for (const color of Object.values(TIER_COLORS)) {
      expect(typeof color).toBe('string')
      expect((color as string).startsWith('#')).toBe(true)
    }
  })
})

// ---------------------------------------------------------------------------
// 4. Obstacle probability thresholds
// ---------------------------------------------------------------------------
describe('getObstacleProbability', () => {
  it('returns 0 for tile indices 0-5 (safe zone)', () => {
    for (let i = 0; i <= 5; i++) {
      expect(getObstacleProbability(i)).toBe(0)
    }
  })

  it('returns 0.08 for tile indices 6-15', () => {
    expect(getObstacleProbability(6)).toBe(0.08)
    expect(getObstacleProbability(10)).toBe(0.08)
    expect(getObstacleProbability(15)).toBe(0.08)
  })

  it('returns 0.15 for tile indices 16-29', () => {
    expect(getObstacleProbability(16)).toBe(0.15)
    expect(getObstacleProbability(20)).toBe(0.15)
    expect(getObstacleProbability(29)).toBe(0.15)
  })

  it('returns 0.25 for tile index 30 and beyond', () => {
    expect(getObstacleProbability(30)).toBe(0.25)
    expect(getObstacleProbability(100)).toBe(0.25)
    expect(getObstacleProbability(999)).toBe(0.25)
  })

  it('probabilities are non-decreasing', () => {
    const samples = [0, 5, 6, 15, 16, 29, 30, 50]
    let prev = -1
    for (const i of samples) {
      const p = getObstacleProbability(i)
      expect(p).toBeGreaterThanOrEqual(prev)
      prev = p
    }
  })
})

// ---------------------------------------------------------------------------
// 5. Expanded AABB collision — spike box vs ball
// ---------------------------------------------------------------------------
/**
 * Mirrors the inline collision check in App.tsx:
 *   bx >= box.minX - BALL_RADIUS &&
 *   bx <= box.maxX + BALL_RADIUS &&
 *   bz >= worldMinZ - BALL_RADIUS &&
 *   bz <= worldMaxZ + BALL_RADIUS
 */
function expandedAABBHit(
  bx: number,
  bz: number,
  box: ObstacleBox,
  tileZ: number,
): boolean {
  const worldMinZ = tileZ + box.minZ
  const worldMaxZ = tileZ + box.maxZ
  return (
    bx >= box.minX - BALL_RADIUS &&
    bx <= box.maxX + BALL_RADIUS &&
    bz >= worldMinZ - BALL_RADIUS &&
    bz <= worldMaxZ + BALL_RADIUS
  )
}

describe('expanded AABB collision (spike)', () => {
  // A spike box at tile.z=0, centered at x=0 with SPIKE_RADIUS half-extents
  const spikeBox: ObstacleBox = {
    minX: -SPIKE_RADIUS,
    maxX: SPIKE_RADIUS,
    minZ: -SPIKE_RADIUS,
    maxZ: SPIKE_RADIUS,
  }
  const tileZ = 0

  it('detects a direct hit when ball center is inside the spike box', () => {
    expect(expandedAABBHit(0, 0, spikeBox, tileZ)).toBe(true)
  })

  it('detects a hit when ball grazes the spike from the left (expanded by BALL_RADIUS)', () => {
    // Ball is just inside the left expanded boundary
    const bx = spikeBox.minX - BALL_RADIUS
    expect(expandedAABBHit(bx, 0, spikeBox, tileZ)).toBe(true)
  })

  it('detects a hit when ball grazes the spike from the right', () => {
    const bx = spikeBox.maxX + BALL_RADIUS
    expect(expandedAABBHit(bx, 0, spikeBox, tileZ)).toBe(true)
  })

  it('misses when ball is just beyond the right expanded boundary', () => {
    const bx = spikeBox.maxX + BALL_RADIUS + 0.01
    expect(expandedAABBHit(bx, 0, spikeBox, tileZ)).toBe(false)
  })

  it('misses when ball is just beyond the left expanded boundary', () => {
    const bx = spikeBox.minX - BALL_RADIUS - 0.01
    expect(expandedAABBHit(bx, 0, spikeBox, tileZ)).toBe(false)
  })

  it('detects hit when ball approaches from behind (z direction)', () => {
    // Ball z is at the expanded front edge (worldMinZ - BALL_RADIUS)
    const bz = tileZ + spikeBox.minZ - BALL_RADIUS
    expect(expandedAABBHit(0, bz, spikeBox, tileZ)).toBe(true)
  })

  it('misses when ball is just past the front expanded z boundary', () => {
    const bz = tileZ + spikeBox.minZ - BALL_RADIUS - 0.01
    expect(expandedAABBHit(0, bz, spikeBox, tileZ)).toBe(false)
  })

  it('works correctly with non-zero tile world z offset', () => {
    const tileWorldZ = -40
    // Ball at world z = tileWorldZ (center of the box in world space)
    expect(expandedAABBHit(0, tileWorldZ, spikeBox, tileWorldZ)).toBe(true)
    // Ball far behind in world space
    expect(expandedAABBHit(0, tileWorldZ - 100, spikeBox, tileWorldZ)).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// 6. Distance / score calculation via tickGameState
// ---------------------------------------------------------------------------
function makeGameStateRefs(speed: number): GameStateRefs {
  // Create minimal ref-like objects that match the GameStateRefs interface
  return {
    speedRef: { current: speed },
    distanceRef: { current: 0 },
    tierRef: { current: getSpeedTier(speed) },
    phaseRef: { current: 'playing' },
    lastSpeedUpDistRef: { current: 0 },
    resetState: () => {},
    setPhase: () => {},
  }
}

describe('tickGameState — distance accumulation', () => {
  it('accumulates distance = speed * delta each frame', () => {
    const refs = makeGameStateRefs(12)
    tickGameState(refs, 1.0) // 1 second frame
    expect(refs.distanceRef.current).toBeCloseTo(12)
  })

  it('accumulates over multiple frames', () => {
    const refs = makeGameStateRefs(20)
    tickGameState(refs, 0.5)
    tickGameState(refs, 0.5)
    expect(refs.distanceRef.current).toBeCloseTo(20)
  })

  it('does not change distance on a zero-delta tick', () => {
    const refs = makeGameStateRefs(15)
    tickGameState(refs, 0)
    expect(refs.distanceRef.current).toBe(0)
  })
})

describe('tickGameState — speed escalation', () => {
  it('increments speed when SPEED_INTERVAL meters have been travelled', () => {
    const refs = makeGameStateRefs(INITIAL_SPEED)
    const initialSpeed = refs.speedRef.current
    // Travel exactly SPEED_INTERVAL meters in one big tick
    tickGameState(refs, SPEED_INTERVAL / INITIAL_SPEED)
    expect(refs.speedRef.current).toBeCloseTo(initialSpeed + SPEED_INCREMENT, 5)
  })

  it('does not increment speed before SPEED_INTERVAL meters', () => {
    const refs = makeGameStateRefs(INITIAL_SPEED)
    // Travel slightly less than SPEED_INTERVAL
    tickGameState(refs, (SPEED_INTERVAL - 0.1) / INITIAL_SPEED)
    expect(refs.speedRef.current).toBe(INITIAL_SPEED)
  })

  it('does not exceed MAX_SPEED', () => {
    const refs = makeGameStateRefs(MAX_SPEED - SPEED_INCREMENT / 2)
    // Force a speed-up
    tickGameState(refs, SPEED_INTERVAL / refs.speedRef.current)
    expect(refs.speedRef.current).toBeLessThanOrEqual(MAX_SPEED)
  })

  it('returns true when tier changes after speed escalation', () => {
    // Start at top of tier 1 (just under 15). After one SPEED_INTERVAL tick at speed 14.6
    // speed becomes 14.6 + 0.5 = 15.1 which crosses into tier 2
    const refs = makeGameStateRefs(14.6)
    refs.tierRef = { current: getSpeedTier(14.6) } // tier 1
    const tierChanged = tickGameState(refs, SPEED_INTERVAL / 14.6)
    expect(tierChanged).toBe(true)
    expect(refs.tierRef.current).toBe(2)
  })

  it('returns false when tier does not change', () => {
    const refs = makeGameStateRefs(INITIAL_SPEED) // well within tier 1
    // Small tick — no speed-up, no tier change
    const tierChanged = tickGameState(refs, 0.016)
    expect(tierChanged).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// 7. Personal best localStorage logic
// ---------------------------------------------------------------------------
describe('personal best — localStorage', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  afterEach(() => {
    localStorage.clear()
    vi.restoreAllMocks()
  })

  it('BEST_KEY constant is defined and non-empty', () => {
    expect(typeof BEST_KEY).toBe('string')
    expect(BEST_KEY.length).toBeGreaterThan(0)
  })

  it('reading from empty localStorage returns null', () => {
    expect(localStorage.getItem(BEST_KEY)).toBeNull()
  })

  it('writing and reading back a score round-trips correctly', () => {
    const score = 250
    localStorage.setItem(BEST_KEY, score.toString())
    const stored = localStorage.getItem(BEST_KEY)
    expect(stored).not.toBeNull()
    expect(parseInt(stored!, 10)).toBe(score)
  })

  it('updating best only when new score is higher', () => {
    // Simulate the pattern used in App.tsx
    let bestScore = 0
    const storedRaw = localStorage.getItem(BEST_KEY)
    if (storedRaw) {
      const parsed = parseInt(storedRaw, 10)
      if (!isNaN(parsed)) bestScore = parsed
    }

    // First run: score 100 > best 0 → save
    const score1 = 100
    if (score1 > bestScore) {
      bestScore = score1
      localStorage.setItem(BEST_KEY, score1.toString())
    }
    expect(bestScore).toBe(100)
    expect(parseInt(localStorage.getItem(BEST_KEY)!, 10)).toBe(100)

    // Second run: score 80 < best 100 → do NOT update
    const score2 = 80
    const isNew2 = score2 > bestScore
    if (isNew2) {
      bestScore = score2
      localStorage.setItem(BEST_KEY, score2.toString())
    }
    expect(isNew2).toBe(false)
    expect(parseInt(localStorage.getItem(BEST_KEY)!, 10)).toBe(100) // unchanged

    // Third run: score 200 > best 100 → update
    const score3 = 200
    const isNew3 = score3 > bestScore
    if (isNew3) {
      bestScore = score3
      localStorage.setItem(BEST_KEY, score3.toString())
    }
    expect(isNew3).toBe(true)
    expect(bestScore).toBe(200)
    expect(parseInt(localStorage.getItem(BEST_KEY)!, 10)).toBe(200)
  })

  it('ignores non-numeric stored values', () => {
    localStorage.setItem(BEST_KEY, 'not-a-number')
    const raw = localStorage.getItem(BEST_KEY)!
    const parsed = parseInt(raw, 10)
    expect(isNaN(parsed)).toBe(true)
    // The App logic guards with isNaN — best stays 0
    let bestScore = 0
    if (!isNaN(parsed)) bestScore = parsed
    expect(bestScore).toBe(0)
  })
})

// ---------------------------------------------------------------------------
// 8. isBallOverGap
// ---------------------------------------------------------------------------
function makeGapTile(tileZ: number): TileData {
  return {
    id: 1,
    z: tileZ,
    obstacleType: ObstacleType.GAP,
    obstacleBoxes: [],
    spikeGapX: 0,
    meshRef: { current: null },
  }
}

function makeNoneTile(tileZ: number): TileData {
  return {
    id: 2,
    z: tileZ,
    obstacleType: ObstacleType.NONE,
    obstacleBoxes: [],
    spikeGapX: 0,
    meshRef: { current: null },
  }
}

describe('isBallOverGap', () => {
  // TILE_DEPTH=8, TILE_WIDTH=6 → halfD=4, halfW=3
  const tileZ = -20
  const gapTile = makeGapTile(tileZ)
  const tiles = [gapTile]

  it('returns true when ball is centered on a gap tile', () => {
    expect(isBallOverGap(tiles, 0, tileZ)).toBe(true)
  })

  it('returns true when ball is at the edge of the gap tile z range', () => {
    // halfD = TILE_DEPTH/2 = 4
    expect(isBallOverGap(tiles, 0, tileZ - 4)).toBe(true)
    expect(isBallOverGap(tiles, 0, tileZ + 4)).toBe(true)
  })

  it('returns false when ball is just outside the z range of the gap tile', () => {
    expect(isBallOverGap(tiles, 0, tileZ - 4.01)).toBe(false)
    expect(isBallOverGap(tiles, 0, tileZ + 4.01)).toBe(false)
  })

  it('returns false when ball x is outside track half-width', () => {
    // halfW = TILE_WIDTH/2 = 3
    expect(isBallOverGap(tiles, 3.01, tileZ)).toBe(false)
    expect(isBallOverGap(tiles, -3.01, tileZ)).toBe(false)
  })

  it('returns true at exact track half-width boundary', () => {
    expect(isBallOverGap(tiles, 3, tileZ)).toBe(true)
    expect(isBallOverGap(tiles, -3, tileZ)).toBe(true)
  })

  it('returns false when the tile type is NONE (not a gap)', () => {
    const noneTiles = [makeNoneTile(tileZ)]
    expect(isBallOverGap(noneTiles, 0, tileZ)).toBe(false)
  })

  it('returns false when tile list is empty', () => {
    expect(isBallOverGap([], 0, tileZ)).toBe(false)
  })

  it('correctly identifies gap among mixed tile types', () => {
    const mixed = [makeNoneTile(-10), makeGapTile(-20), makeNoneTile(-30)]
    expect(isBallOverGap(mixed, 0, -20)).toBe(true)
    expect(isBallOverGap(mixed, 0, -10)).toBe(false)
    expect(isBallOverGap(mixed, 0, -30)).toBe(false)
  })
})
