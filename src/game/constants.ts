// Track geometry
export const TILE_WIDTH = 6
export const TILE_DEPTH = 8
export const TILE_HEIGHT = 0.2
export const TILE_COUNT = 20
export const EDGE_THICKNESS = 0.12
export const EDGE_HEIGHT = 0.3

// Ball physics
export const INITIAL_SPEED = 12
export const MAX_SPEED = 45
export const SPEED_INCREMENT = 0.5
export const SPEED_INTERVAL = 20 // meters between speed increases

// Lateral steering
export const LATERAL_ACCEL = 12       // units/sec² while key held
export const LATERAL_DECEL = 20       // units/sec² on release
export const MAX_LATERAL_VEL = 8      // max ±units/sec
export const TRACK_HALF_WIDTH = 2.5   // keeps ball from rolling off edge

// Camera
export const CAM_X_FACTOR = 0.4
export const CAM_X_LERP = 0.08
export const CAM_Y = 3
export const CAM_Z_OFFSET = 8

// Visuals
export const TILE_SURFACE_COLOR = '#1a0a2e'
export const BG_COLOR = '#0a0010'
export const EMISSIVE_INTENSITY = 0.4

// Speed tiers
export const TIER_COLORS = {
  1: '#7c3aed',   // purple (0-15)
  2: '#06b6d4',   // cyan (15-25)
  3: '#ec4899',   // hot pink (25-37)
  4: '#ffffff',   // white (37+)
} as const

export type SpeedTier = 1 | 2 | 3 | 4

export function getSpeedTier(speed: number): SpeedTier {
  if (speed < 15) return 1
  if (speed < 25) return 2
  if (speed < 37) return 3
  return 4
}

export function getTierColor(tier: SpeedTier): string {
  return TIER_COLORS[tier]
}

// Starfield
export const STAR_COUNT = 800
export const STAR_SIZE = 0.15
export const STAR_BOX = { x: 200, y: 200, z: 400 }

// Fog
export const FOG_DENSITY = 0.04

// Scene
export const BALL_RADIUS = 0.4
export const BALL_Y = TILE_HEIGHT / 2 + BALL_RADIUS

// Game phases
export const GamePhase = {
  PLAYING: 'playing',
  DEAD: 'dead',
} as const
export type GamePhase = typeof GamePhase[keyof typeof GamePhase]
