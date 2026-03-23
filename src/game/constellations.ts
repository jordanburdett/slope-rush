import {
  CONSTELLATION_KEY,
  CONSTELLATION_MAX,
  type ConstellationEntry,
  type SpeedTier,
} from './constants'

// ---------------------------------------------------------------------------
// LCG helpers — deterministic RNG seeded on distance
// ---------------------------------------------------------------------------
function lcgNext(s: number): number {
  return (s * 9301 + 49297) % 233280
}

/** Advance the seed and return a value in [-1, 1]. */
function lcgNorm(s: number): { val: number; next: number } {
  const next = lcgNext(s)
  const val = (next / 233280) * 2 - 1
  return { val, next }
}

// ---------------------------------------------------------------------------
// generateConstellation
// ---------------------------------------------------------------------------
export function generateConstellation(
  distance: number,
  tier: SpeedTier,
  oldBest: number,
): ConstellationEntry {
  const starCount = 5 + (distance % 4) // 5–8 deterministically

  const improvementMargin = distance - oldBest
  const brightness = 0.5 + Math.min(1, improvementMargin / 50) * 0.5

  // Initialise LCG seed
  let s = (distance * 9301 + 49297) % 233280

  const stars: ConstellationEntry['stars'] = []
  for (let i = 0; i < starCount; i++) {
    const rx = lcgNorm(s)
    s = rx.next
    const ry = lcgNorm(s)
    s = ry.next
    const rz = lcgNorm(s)
    s = rz.next

    stars.push({
      x: rx.val * 30,   // [-30, 30]
      y: ry.val * 20,   // [-20, 20]
      z: rz.val * 60,   // [-60, 60]
      brightness,
    })
  }

  return {
    distance,
    tier,
    stars,
    timestamp: Date.now(),
  }
}

// ---------------------------------------------------------------------------
// loadConstellations
// ---------------------------------------------------------------------------
export function loadConstellations(): ConstellationEntry[] {
  try {
    const raw = localStorage.getItem(CONSTELLATION_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed as ConstellationEntry[]
  } catch {
    return []
  }
}

// ---------------------------------------------------------------------------
// saveConstellation
// ---------------------------------------------------------------------------
export function saveConstellation(entry: ConstellationEntry): void {
  const existing = loadConstellations()
  existing.unshift(entry)
  const trimmed = existing.slice(0, CONSTELLATION_MAX)
  localStorage.setItem(CONSTELLATION_KEY, JSON.stringify(trimmed))
}
