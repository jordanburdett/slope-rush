/**
 * Tests for slope-rush-evo2-001:
 * Constellation data layer — generateConstellation, loadConstellations, saveConstellation
 *
 * Covers:
 *   1. generateConstellation(100, 2, 50) — 5 stars, brightness 1.0
 *   2. generateConstellation(100, 2, 100) — no improvement, brightness 0.5
 *   3. loadConstellations() — returns [] on empty localStorage
 *   4. loadConstellations() — returns [] on non-array JSON
 *   5. loadConstellations() — returns [] on corrupt JSON
 *   6. saveConstellation — persists to CONSTELLATION_KEY
 *   7. saveConstellation — caps stored array at CONSTELLATION_MAX (50) entries
 *   8. saveConstellation — prepends (newest entry first)
 *   9. Star positions are deterministic (same distance = same positions)
 *  10. Star count is 5 + (distance % 4) for various distances
 *  11. Star coordinates stay within expected bounds
 *  12. Partial improvement: brightness is proportional
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import {
  generateConstellation,
  loadConstellations,
  saveConstellation,
} from '../constellations'
import {
  CONSTELLATION_KEY,
  CONSTELLATION_MAX,
} from '../constants'

// ---------------------------------------------------------------------------
// Setup: clear localStorage before and after each test
// ---------------------------------------------------------------------------
beforeEach(() => {
  localStorage.clear()
})

afterEach(() => {
  localStorage.clear()
})

// ---------------------------------------------------------------------------
// 1. generateConstellation — star count and brightness
// ---------------------------------------------------------------------------
describe('generateConstellation — star count', () => {
  it('distance=100 produces 5 stars (5 + (100 % 4) = 5)', () => {
    const entry = generateConstellation(100, 2, 50)
    expect(entry.stars).toHaveLength(5)
  })

  it('distance=101 produces 6 stars (5 + (101 % 4) = 6)', () => {
    const entry = generateConstellation(101, 1, 0)
    expect(entry.stars).toHaveLength(6)
  })

  it('distance=102 produces 7 stars (5 + (102 % 4) = 7)', () => {
    const entry = generateConstellation(102, 1, 0)
    expect(entry.stars).toHaveLength(7)
  })

  it('distance=103 produces 8 stars (5 + (103 % 4) = 8)', () => {
    const entry = generateConstellation(103, 1, 0)
    expect(entry.stars).toHaveLength(8)
  })

  it('distance=104 wraps back to 5 stars (5 + (104 % 4) = 5)', () => {
    const entry = generateConstellation(104, 1, 0)
    expect(entry.stars).toHaveLength(5)
  })

  it('distance=0 produces 5 stars (minimum count)', () => {
    const entry = generateConstellation(0, 1, 0)
    expect(entry.stars).toHaveLength(5)
  })
})

// ---------------------------------------------------------------------------
// 2. generateConstellation — brightness formula
// ---------------------------------------------------------------------------
describe('generateConstellation — brightness', () => {
  it('generateConstellation(100, 2, 50): 50m improvement → brightness 1.0', () => {
    // improvement = 100 - 50 = 50; Math.min(1, 50/50) = 1.0; 0.5 + 1.0*0.5 = 1.0
    const entry = generateConstellation(100, 2, 50)
    entry.stars.forEach((star) => {
      expect(star.brightness).toBeCloseTo(1.0, 10)
    })
  })

  it('generateConstellation(100, 2, 100): no improvement → brightness 0.5', () => {
    // improvement = 100 - 100 = 0; Math.min(1, 0/50) = 0; 0.5 + 0*0.5 = 0.5
    const entry = generateConstellation(100, 2, 100)
    entry.stars.forEach((star) => {
      expect(star.brightness).toBeCloseTo(0.5, 10)
    })
  })

  it('generateConstellation(100, 2, 75): 25m improvement → brightness 0.75', () => {
    // improvement = 25; Math.min(1, 25/50) = 0.5; 0.5 + 0.5*0.5 = 0.75
    const entry = generateConstellation(100, 2, 75)
    entry.stars.forEach((star) => {
      expect(star.brightness).toBeCloseTo(0.75, 10)
    })
  })

  it('improvement > 50 clamps to brightness 1.0', () => {
    // improvement = 200 - 0 = 200; Math.min(1, 200/50) = 1; brightness = 1.0
    const entry = generateConstellation(200, 1, 0)
    entry.stars.forEach((star) => {
      expect(star.brightness).toBeCloseTo(1.0, 10)
    })
  })

  it('all stars within one entry share the same brightness value', () => {
    const entry = generateConstellation(100, 2, 60)
    const b0 = entry.stars[0].brightness
    entry.stars.forEach((star) => {
      expect(star.brightness).toBe(b0)
    })
  })
})

// ---------------------------------------------------------------------------
// 3. generateConstellation — structure
// ---------------------------------------------------------------------------
describe('generateConstellation — entry structure', () => {
  it('returns distance matching the input', () => {
    const entry = generateConstellation(77, 3, 50)
    expect(entry.distance).toBe(77)
  })

  it('returns tier matching the input', () => {
    const entry = generateConstellation(77, 3, 50)
    expect(entry.tier).toBe(3)
  })

  it('returns a positive numeric timestamp', () => {
    const before = Date.now()
    const entry = generateConstellation(50, 1, 0)
    const after = Date.now()
    expect(entry.timestamp).toBeGreaterThanOrEqual(before)
    expect(entry.timestamp).toBeLessThanOrEqual(after)
  })

  it('each star has x, y, z, brightness properties', () => {
    const entry = generateConstellation(100, 2, 50)
    for (const star of entry.stars) {
      expect(typeof star.x).toBe('number')
      expect(typeof star.y).toBe('number')
      expect(typeof star.z).toBe('number')
      expect(typeof star.brightness).toBe('number')
    }
  })
})

// ---------------------------------------------------------------------------
// 4. generateConstellation — coordinate bounds
// ---------------------------------------------------------------------------
describe('generateConstellation — star coordinate bounds', () => {
  it('all star x values are within [-30, 30]', () => {
    // Test several distances to cover different seeds
    for (const dist of [0, 50, 100, 101, 102, 103, 999]) {
      const entry = generateConstellation(dist, 1, 0)
      for (const star of entry.stars) {
        expect(star.x).toBeGreaterThanOrEqual(-30)
        expect(star.x).toBeLessThanOrEqual(30)
      }
    }
  })

  it('all star y values are within [-20, 20]', () => {
    for (const dist of [0, 50, 100, 101, 102, 103, 999]) {
      const entry = generateConstellation(dist, 1, 0)
      for (const star of entry.stars) {
        expect(star.y).toBeGreaterThanOrEqual(-20)
        expect(star.y).toBeLessThanOrEqual(20)
      }
    }
  })

  it('all star z values are within [-60, 60]', () => {
    for (const dist of [0, 50, 100, 101, 102, 103, 999]) {
      const entry = generateConstellation(dist, 1, 0)
      for (const star of entry.stars) {
        expect(star.z).toBeGreaterThanOrEqual(-60)
        expect(star.z).toBeLessThanOrEqual(60)
      }
    }
  })
})

// ---------------------------------------------------------------------------
// 5. generateConstellation — determinism
// ---------------------------------------------------------------------------
describe('generateConstellation — deterministic positions', () => {
  it('same distance produces identical star positions on repeated calls', () => {
    const a = generateConstellation(100, 2, 50)
    const b = generateConstellation(100, 2, 50)
    expect(a.stars.length).toBe(b.stars.length)
    for (let i = 0; i < a.stars.length; i++) {
      expect(a.stars[i].x).toBe(b.stars[i].x)
      expect(a.stars[i].y).toBe(b.stars[i].y)
      expect(a.stars[i].z).toBe(b.stars[i].z)
    }
  })

  it('different distances produce different star positions', () => {
    const a = generateConstellation(100, 1, 0)
    const b = generateConstellation(200, 1, 0)
    // At minimum the first star's x should differ (different LCG seeds)
    expect(a.stars[0].x).not.toBe(b.stars[0].x)
  })

  it('changing tier or oldBest does not affect star positions (only brightness)', () => {
    // a: distance=100, oldBest=50  → improvement=50 → brightness=1.0
    // b: distance=100, oldBest=70  → improvement=30 → brightness=0.8
    const a = generateConstellation(100, 1, 50)
    const b = generateConstellation(100, 4, 70) // different tier and oldBest
    // Positions must be identical (LCG seed is derived from distance only)
    for (let i = 0; i < a.stars.length; i++) {
      expect(a.stars[i].x).toBe(b.stars[i].x)
      expect(a.stars[i].y).toBe(b.stars[i].y)
      expect(a.stars[i].z).toBe(b.stars[i].z)
    }
    // Brightness must differ: 1.0 vs 0.8
    expect(a.stars[0].brightness).not.toBe(b.stars[0].brightness)
  })
})

// ---------------------------------------------------------------------------
// 6. loadConstellations — empty and missing storage
// ---------------------------------------------------------------------------
describe('loadConstellations — empty storage', () => {
  it('returns [] when localStorage has no constellation key', () => {
    expect(loadConstellations()).toEqual([])
  })

  it('returns [] when stored value is null (key missing)', () => {
    // localStorage.getItem returns null for missing keys
    localStorage.removeItem(CONSTELLATION_KEY)
    expect(loadConstellations()).toEqual([])
  })

  it('returns [] when stored value is an empty array', () => {
    localStorage.setItem(CONSTELLATION_KEY, '[]')
    expect(loadConstellations()).toEqual([])
  })

  it('returns [] when stored value is not an array (e.g. plain object)', () => {
    localStorage.setItem(CONSTELLATION_KEY, '{"foo":"bar"}')
    expect(loadConstellations()).toEqual([])
  })

  it('returns [] when stored value is malformed JSON', () => {
    localStorage.setItem(CONSTELLATION_KEY, '{corrupt!json[}')
    expect(loadConstellations()).toEqual([])
  })

  it('returns [] when stored value is a JSON number', () => {
    localStorage.setItem(CONSTELLATION_KEY, '42')
    expect(loadConstellations()).toEqual([])
  })

  it('returns [] when stored value is a JSON string', () => {
    localStorage.setItem(CONSTELLATION_KEY, '"hello"')
    expect(loadConstellations()).toEqual([])
  })
})

// ---------------------------------------------------------------------------
// 7. saveConstellation — persistence
// ---------------------------------------------------------------------------
describe('saveConstellation — persistence', () => {
  it('persists to the CONSTELLATION_KEY localStorage key', () => {
    const entry = generateConstellation(100, 2, 50)
    saveConstellation(entry)
    const raw = localStorage.getItem(CONSTELLATION_KEY)
    expect(raw).not.toBeNull()
  })

  it('stored data is valid JSON containing the entry', () => {
    const entry = generateConstellation(100, 2, 50)
    saveConstellation(entry)
    const raw = localStorage.getItem(CONSTELLATION_KEY)!
    const parsed = JSON.parse(raw)
    expect(Array.isArray(parsed)).toBe(true)
    expect(parsed).toHaveLength(1)
    expect(parsed[0].distance).toBe(100)
    expect(parsed[0].tier).toBe(2)
  })

  it('loadConstellations returns the saved entry', () => {
    const entry = generateConstellation(100, 2, 50)
    saveConstellation(entry)
    const loaded = loadConstellations()
    expect(loaded).toHaveLength(1)
    expect(loaded[0].distance).toBe(entry.distance)
    expect(loaded[0].tier).toBe(entry.tier)
  })

  it('prepends new entries so most recent is first', () => {
    const first = generateConstellation(100, 1, 0)
    saveConstellation(first)
    const second = generateConstellation(150, 2, 100)
    saveConstellation(second)

    const loaded = loadConstellations()
    expect(loaded[0].distance).toBe(150) // newest first
    expect(loaded[1].distance).toBe(100)
  })

  it('accumulates multiple entries across saves', () => {
    for (let i = 1; i <= 5; i++) {
      saveConstellation(generateConstellation(i * 10, 1, 0))
    }
    expect(loadConstellations()).toHaveLength(5)
  })
})

// ---------------------------------------------------------------------------
// 8. saveConstellation — cap at CONSTELLATION_MAX (50)
// ---------------------------------------------------------------------------
describe('saveConstellation — capped at CONSTELLATION_MAX', () => {
  it('never stores more than CONSTELLATION_MAX entries', () => {
    // Fill beyond the cap
    for (let i = 0; i < CONSTELLATION_MAX + 10; i++) {
      saveConstellation(generateConstellation(i + 1, 1, 0))
    }
    const loaded = loadConstellations()
    expect(loaded.length).toBeLessThanOrEqual(CONSTELLATION_MAX)
  })

  it('stores exactly CONSTELLATION_MAX entries when cap is reached', () => {
    for (let i = 0; i < CONSTELLATION_MAX + 5; i++) {
      saveConstellation(generateConstellation(i + 1, 1, 0))
    }
    expect(loadConstellations()).toHaveLength(CONSTELLATION_MAX)
  })

  it('keeps the most-recently-saved entries when cap is exceeded', () => {
    // Save CONSTELLATION_MAX + 1 entries (distances 1..51)
    for (let i = 1; i <= CONSTELLATION_MAX + 1; i++) {
      saveConstellation(generateConstellation(i, 1, 0))
    }
    const loaded = loadConstellations()
    // The oldest entry (distance=1) should have been evicted
    const distances = loaded.map((e) => e.distance)
    expect(distances).not.toContain(1)
    // The newest entry (distance=CONSTELLATION_MAX+1) should be first
    expect(loaded[0].distance).toBe(CONSTELLATION_MAX + 1)
  })
})

// ---------------------------------------------------------------------------
// 9. CONSTELLATION_KEY and CONSTELLATION_MAX constants
// ---------------------------------------------------------------------------
describe('CONSTELLATION_KEY and CONSTELLATION_MAX constants', () => {
  it("CONSTELLATION_KEY equals 'slope-rush-constellations'", () => {
    expect(CONSTELLATION_KEY).toBe('slope-rush-constellations')
  })

  it('CONSTELLATION_MAX equals 50', () => {
    expect(CONSTELLATION_MAX).toBe(50)
  })
})
