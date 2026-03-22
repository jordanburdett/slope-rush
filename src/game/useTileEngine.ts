import { useRef } from 'react'
import { TILE_COUNT, TILE_DEPTH } from './constants'

export interface TileData {
  id: number
  z: number
}

export interface TileEngineRefs {
  tilesRef: React.MutableRefObject<TileData[]>
}

export function useTileEngine(): TileEngineRefs {
  const tilesRef = useRef<TileData[]>(
    Array.from({ length: TILE_COUNT }, (_, i) => ({
      id: i,
      z: -i * TILE_DEPTH, // tiles stretch forward (negative z)
    })),
  )

  return { tilesRef }
}

/**
 * Recycles tiles that have passed behind the ball.
 * A tile is "passed" when its far edge (tile.z + TILE_DEPTH/2) > ballZ + 2.
 * Repositions it to front of queue.
 */
export function tickTileEngine(
  tilesRef: React.MutableRefObject<TileData[]>,
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
      tile.z = minZ - TILE_DEPTH
    }
  }
}
