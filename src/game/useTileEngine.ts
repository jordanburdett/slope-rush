import { useRef } from 'react'
import * as THREE from 'three'
import {
  TILE_COUNT,
  TILE_DEPTH,
  TILE_WIDTH,
  SPIKE_RADIUS,
  ObstacleType,
  getObstacleProbability,
  type ObstacleType as ObstacleTypeValue,
} from './constants'

export interface ObstacleBox {
  minX: number
  maxX: number
  minZ: number
  maxZ: number
}

export interface TileData {
  id: number
  z: number
  obstacleType: ObstacleTypeValue
  obstacleBoxes: ObstacleBox[]
  /** Spike gap offset: the center x of the 2-unit clear gap (for spike type) */
  spikeGapX: number
  /** Ref to the floor mesh so we can animate opacity on recycle */
  meshRef: React.MutableRefObject<THREE.Mesh | null>
}

// Counter for globally unique tile IDs across recycles
let nextTileId = TILE_COUNT

/**
 * Pick an obstacle type based on tile generation index (how many tiles have been created).
 * tileGenIndex = 0 is the first tile ever spawned.
 *
 * Distribution among obstacle tiles:
 *   NARROWING  ~35%
 *   GAP        ~29%
 *   SPIKE      ~24%
 *   SPEED_PAD  ~12%
 * (proportions from: 30/85, 25/85, 20/85, 10/85 — normalized to sum 1)
 */
function pickObstacleType(tileGenIndex: number): ObstacleTypeValue {
  const prob = getObstacleProbability(tileGenIndex)
  if (Math.random() >= prob) return ObstacleType.NONE
  // Weighted distribution: NARROWING ~30, GAP ~25, SPIKE ~20, SPEED_PAD ~10 (total 85)
  const r = Math.random()
  if (r < 30 / 85) return ObstacleType.NARROWING
  if (r < 55 / 85) return ObstacleType.GAP
  if (r < 75 / 85) return ObstacleType.SPIKE
  return ObstacleType.SPEED_PAD
}

/**
 * Build obstacle boxes in tile-local space (z=0 is tile center).
 * At collision time, offset minZ/maxZ by tile.z to get world coords.
 */
function buildObstacleBoxes(
  obstacleType: ObstacleTypeValue,
  spikeGapX: number,
): ObstacleBox[] {
  if (obstacleType !== ObstacleType.SPIKE) return []

  const boxes: ObstacleBox[] = []
  // Spikes placed at regular x intervals, skipping 2-unit gap
  // Tile x: -3 to +3; cone positions at: -2.25, -0.75, +0.75, +2.25
  const spikeXPositions = [-2.25, -0.75, 0.75, 2.25]
  for (const cx of spikeXPositions) {
    if (cx >= spikeGapX - 1 && cx <= spikeGapX + 1) continue
    boxes.push({
      minX: cx - SPIKE_RADIUS,
      maxX: cx + SPIKE_RADIUS,
      // Local z offsets — add tile.z at collision check time
      minZ: -SPIKE_RADIUS,
      maxZ: SPIKE_RADIUS,
    })
  }
  return boxes
}

function makeTile(id: number, z: number, genIndex: number, existingMeshRef?: React.MutableRefObject<THREE.Mesh | null>): TileData {
  const obstacleType = pickObstacleType(genIndex)
  // Random gap center for spike: range [-1, +1] so gap stays on track
  const spikeGapX = (Math.random() - 0.5) * 2 // -1 to +1
  const obstacleBoxes = buildObstacleBoxes(obstacleType, spikeGapX)
  const meshRef = existingMeshRef ?? { current: null }
  return { id, z, obstacleType, obstacleBoxes, spikeGapX, meshRef }
}

export interface TileEngineRefs {
  tilesRef: React.MutableRefObject<TileData[]>
  tileGenIndexRef: React.MutableRefObject<number>
}

export function useTileEngine(): TileEngineRefs {
  const tileGenIndexRef = useRef<number>(TILE_COUNT)

  // Persistent mesh refs — one per tile slot, never recreated
  const meshRefsPool = useRef<Array<React.MutableRefObject<THREE.Mesh | null>>>(
    Array.from({ length: TILE_COUNT }, () => ({ current: null })),
  )

  const tilesRef = useRef<TileData[]>(
    Array.from({ length: TILE_COUNT }, (_, i) => {
      const z = -i * TILE_DEPTH
      return makeTile(i, z, i, meshRefsPool.current[i])
    }),
  )

  return { tilesRef, tileGenIndexRef }
}

/**
 * Recycles tiles that have passed behind the ball.
 * A tile is "passed" when its far edge (tile.z + TILE_DEPTH/2) > ballZ + 2.
 * Repositions it to front of queue with a new obstacle.
 */
export function tickTileEngine(
  tilesRef: React.MutableRefObject<TileData[]>,
  tileGenIndexRef: React.MutableRefObject<number>,
  ballZ: number,
): void {
  const tiles = tilesRef.current

  for (let i = 0; i < tiles.length; i++) {
    const tile = tiles[i]
    // Tile center is tile.z. Front edge (closest to camera) is tile.z + TILE_DEPTH/2
    if (tile.z > ballZ + 2) {
      // Find the minimum z among all tiles to place this one ahead
      let minZ = Infinity
      for (let j = 0; j < tiles.length; j++) {
        if (tiles[j].z < minZ) minZ = tiles[j].z
      }
      const newZ = minZ - TILE_DEPTH
      const genIndex = tileGenIndexRef.current++
      const newId = nextTileId++
      // Re-use the existing meshRef for this slot so the R3F ref still points to the same mesh
      const newTile = makeTile(newId, newZ, genIndex, tile.meshRef)
      // Trigger fade-in: the Track component will lerp opacity back to 1
      if (tile.meshRef.current) {
        const mat = tile.meshRef.current.material as THREE.MeshStandardMaterial
        if (mat) mat.opacity = 0.5
      }
      tiles[i] = newTile
    }
  }
}

/**
 * Reset all tiles to initial positions (for restart).
 * Tiles 0-5 get no obstacles.
 */
export function resetTileEngine(
  tilesRef: React.MutableRefObject<TileData[]>,
  tileGenIndexRef: React.MutableRefObject<number>,
): void {
  tileGenIndexRef.current = TILE_COUNT
  const tiles = tilesRef.current
  for (let i = 0; i < TILE_COUNT; i++) {
    const z = -i * TILE_DEPTH
    // Assign a fresh ID so the Track component's id-change guard fires on restart
    tiles[i] = makeTile(nextTileId++, z, i, tiles[i].meshRef)
  }
}

/**
 * Check if the ball is over a gap tile. Returns true if ball is above a gap.
 */
export function isBallOverGap(
  tiles: TileData[],
  ballX: number,
  ballZ: number,
): boolean {
  for (const tile of tiles) {
    if (tile.obstacleType !== ObstacleType.GAP) continue
    const halfW = TILE_WIDTH / 2
    const halfD = TILE_DEPTH / 2
    if (
      ballZ >= tile.z - halfD &&
      ballZ <= tile.z + halfD &&
      ballX >= -halfW &&
      ballX <= halfW
    ) {
      return true
    }
  }
  return false
}
