import { useEffect, useRef, useMemo, useState, useCallback } from 'react'
import { Canvas, useFrame, useThree } from '@react-three/fiber'
import * as THREE from 'three'
import {
  TILE_WIDTH,
  TILE_DEPTH,
  TILE_HEIGHT,
  TILE_COUNT,
  EDGE_THICKNESS,
  EDGE_HEIGHT,
  BALL_RADIUS,
  BALL_Y,
  CAM_X_FACTOR,
  CAM_X_LERP,
  CAM_Y,
  CAM_Z_OFFSET,
  FOG_DENSITY,
  STAR_COUNT,
  STAR_SIZE,
  STAR_BOX,
  TILE_SURFACE_COLOR,
  BG_COLOR,
  getTierColor,
  getTierLabel,
  getSpeedTier,
  INITIAL_SPEED,
  MAX_SPEED,
  NARROWING_HALF,
  NARROWING_WALL_WIDTH,
  SPIKE_RADIUS,
  SPIKE_HEIGHT,
  DEATH_Y,
  NARROWING_DEATH_X,
  FRAGMENT_COUNT,
  FRAGMENT_RADIUS,
  BEST_KEY,
  TIER_COLORS,
  ObstacleType,
  GamePhase,
  type SpeedTier,
  type GamePhase as GamePhaseType,
  type ConstellationEntry,
} from './game/constants'
import {
  generateConstellation,
  loadConstellations,
  saveConstellation,
} from './game/constellations'
import { useGameState, tickGameState } from './game/useGameState'
import { useBallPhysics, tickBallPhysics } from './game/useBallPhysics'
import { useTileEngine, tickTileEngine, resetTileEngine, isBallOverGap } from './game/useTileEngine'
import type { TileData } from './game/useTileEngine'
import { useAudio } from './game/useAudio'

// ---------------------------------------------------------------------------
// BloomState — radial particle burst on PB-beating death
// ---------------------------------------------------------------------------
export interface BloomState {
  active: boolean
  elapsed: number                       // seconds since bloom started
  deathPos: THREE.Vector3               // world position of ball at death
  color: string                         // tier hex color at death
  // Per-particle: start pos (near deathPos), end pos (final constellation star pos)
  particles: Array<{
    startX: number; startY: number; startZ: number
    endX: number; endY: number; endZ: number
  }>
}

// ---------------------------------------------------------------------------
// BloomParticles — animated particle burst expanding to constellation positions
// ---------------------------------------------------------------------------
interface BloomParticlesProps {
  bloomRef: React.MutableRefObject<BloomState>
}

function BloomParticles({ bloomRef }: BloomParticlesProps) {
  const MAX_PARTICLES = 8
  const matRef = useRef<THREE.PointsMaterial>(null)
  const pointsRef = useRef<THREE.Points>(null)
  const wasActiveRef = useRef<boolean>(false)

  // Store mutable geometry data in refs so the linter allows mutation
  const posBufferRef = useRef<Float32Array>(new Float32Array(MAX_PARTICLES * 3))
  const geoRef = useRef<THREE.BufferGeometry>(new THREE.BufferGeometry())

  // Wire up geometry attribute after mount
  useEffect(() => {
    const geo = geoRef.current
    const buf = posBufferRef.current
    geo.setAttribute('position', new THREE.BufferAttribute(buf, 3))
    geo.setDrawRange(0, 0)
    if (pointsRef.current) {
      pointsRef.current.geometry = geo
    }
  }, [])

  useFrame((_state, delta) => {
    const points = pointsRef.current
    if (!points) return

    const bloom = bloomRef.current

    if (!bloom.active) {
      points.visible = false
      wasActiveRef.current = false
      return
    }

    points.visible = true

    const BLOOM_DURATION = 1.0
    const geo = geoRef.current
    const buf = posBufferRef.current

    // Set color and draw range only on first active frame
    if (!wasActiveRef.current) {
      wasActiveRef.current = true
      if (matRef.current) matRef.current.color.set(bloom.color)
      geo.setDrawRange(0, bloom.particles.length)
    }

    bloom.elapsed += delta
    const t = Math.min(bloom.elapsed / BLOOM_DURATION, 1.0)
    const eased = 1 - Math.pow(1 - t, 3)

    for (let i = 0; i < bloom.particles.length; i++) {
      const p = bloom.particles[i]
      buf[i * 3 + 0] = p.startX + (p.endX - p.startX) * eased
      buf[i * 3 + 1] = p.startY + (p.endY - p.startY) * eased
      buf[i * 3 + 2] = p.startZ + (p.endZ - p.startZ) * eased
    }

    const posAttr = geo.getAttribute('position')
    if (posAttr) posAttr.needsUpdate = true

    if (t >= 1.0) {
      bloom.active = false
    }
  })

  return (
    <points ref={pointsRef}>
      <pointsMaterial ref={matRef} size={0.25} sizeAttenuation />
    </points>
  )
}

// ---------------------------------------------------------------------------
// Starfield
// ---------------------------------------------------------------------------
function Starfield() {
  const positions = useMemo(() => {
    const arr = new Float32Array(STAR_COUNT * 3)
    for (let i = 0; i < STAR_COUNT; i++) {
      arr[i * 3 + 0] = (Math.random() - 0.5) * STAR_BOX.x
      arr[i * 3 + 1] = (Math.random() - 0.5) * STAR_BOX.y
      arr[i * 3 + 2] = (Math.random() - 0.5) * STAR_BOX.z
    }
    return arr
  }, [])

  const geo = useMemo(() => {
    const g = new THREE.BufferGeometry()
    g.setAttribute('position', new THREE.BufferAttribute(positions, 3))
    return g
  }, [positions])

  return (
    <points geometry={geo}>
      <pointsMaterial size={STAR_SIZE} color="#ffffff" sizeAttenuation />
    </points>
  )
}

// ---------------------------------------------------------------------------
// Constellations — persisted PB star clouds
// ---------------------------------------------------------------------------
interface ConstellationsProps {
  constellationDataRef: React.MutableRefObject<ConstellationEntry[]>
  newConstellationRef: React.MutableRefObject<ConstellationEntry | null>
}

function Constellations({ constellationDataRef, newConstellationRef }: ConstellationsProps) {
  const geoRef = useRef<THREE.BufferGeometry>(new THREE.BufferGeometry())
  const colorsRef = useRef<Float32Array>(new Float32Array(0))

  // Build flat position + color arrays from a list of entries
  function buildBuffers(entries: ConstellationEntry[]): {
    positions: Float32Array
    colors: Float32Array
  } {
    let totalStars = 0
    for (const entry of entries) {
      totalStars += entry.stars.length
    }
    const positions = new Float32Array(totalStars * 3)
    const colors = new Float32Array(totalStars * 3)
    let idx = 0
    for (const entry of entries) {
      const c = new THREE.Color(TIER_COLORS[entry.tier])
      for (const star of entry.stars) {
        positions[idx * 3 + 0] = star.x
        positions[idx * 3 + 1] = star.y
        positions[idx * 3 + 2] = star.z
        colors[idx * 3 + 0] = c.r * star.brightness
        colors[idx * 3 + 1] = c.g * star.brightness
        colors[idx * 3 + 2] = c.b * star.brightness
        idx++
      }
    }
    return { positions, colors }
  }

  // On mount: load persisted constellations and build initial geometry
  useEffect(() => {
    constellationDataRef.current = loadConstellations()
    const { positions, colors } = buildBuffers(constellationDataRef.current)
    geoRef.current.setAttribute('position', new THREE.BufferAttribute(positions, 3))
    geoRef.current.setAttribute('color', new THREE.BufferAttribute(colors, 3))
    colorsRef.current = colors
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useFrame(() => {
    const newEntry = newConstellationRef.current
    if (newEntry !== null) {
      // Append to data list
      constellationDataRef.current = [newEntry, ...constellationDataRef.current]
      // Rebuild buffers
      const { positions, colors } = buildBuffers(constellationDataRef.current)
      geoRef.current.setAttribute('position', new THREE.BufferAttribute(positions, 3))
      geoRef.current.setAttribute('color', new THREE.BufferAttribute(colors, 3))
      const posAttr = geoRef.current.getAttribute('position')
      const colAttr = geoRef.current.getAttribute('color')
      if (posAttr) posAttr.needsUpdate = true
      if (colAttr) colAttr.needsUpdate = true
      colorsRef.current = colors
      // Clear the signal
      newConstellationRef.current = null
    }
  })

  return (
    <points geometry={geoRef.current}>
      <pointsMaterial vertexColors size={0.2} sizeAttenuation />
    </points>
  )
}

// ---------------------------------------------------------------------------
// Track — rendered from tilesRef positions + obstacle data
// ---------------------------------------------------------------------------
interface TrackProps {
  tilesRef: React.MutableRefObject<TileData[]>
  tierColorRef: React.MutableRefObject<string>
}

function Track({ tilesRef, tierColorRef }: TrackProps) {
  // Tile group refs so we can teleport them without React re-renders
  const groupRefs = useRef<Array<THREE.Group | null>>(
    Array.from({ length: TILE_COUNT }, () => null),
  )
  const floorMeshRefs = useRef<Array<THREE.Mesh | null>>(
    Array.from({ length: TILE_COUNT }, () => null),
  )
  const edgeMaterialRefs = useRef<Array<Array<THREE.MeshStandardMaterial | null>>>(
    Array.from({ length: TILE_COUNT }, () => [null, null, null]),
  )
  // Narrowing wall mesh refs: [tileIndex][0=left, 1=right]
  const narrowingMeshRefs = useRef<Array<[THREE.Mesh | null, THREE.Mesh | null]>>(
    Array.from({ length: TILE_COUNT }, () => [null, null]),
  )
  // Spike group refs per tile
  const spikeGroupRefs = useRef<Array<THREE.Group | null>>(
    Array.from({ length: TILE_COUNT }, () => null),
  )
  // Speed pad mesh refs per tile
  const speedPadMeshRefs = useRef<Array<THREE.Mesh | null>>(
    Array.from({ length: TILE_COUNT }, () => null),
  )

  // Track which tile index had which obstacle last time we set it up
  const lastObstacleTypeRef = useRef<Array<string>>(
    Array.from({ length: TILE_COUNT }, () => 'none'),
  )
  const lastTileIdRef = useRef<Array<number>>(
    Array.from({ length: TILE_COUNT }, (_, i) => i),
  )

  // Keep tier color update separate from position update
  const lastTierColorRef = useRef<string>(tierColorRef.current)

  useFrame((_state, delta) => {
    const tiles = tilesRef.current

    // Update positions every frame
    for (let i = 0; i < tiles.length; i++) {
      const group = groupRefs.current[i]
      const tile = tiles[i]
      if (group) {
        group.position.z = tile.z
      }

      // Tile recycled — update obstacle visibility
      if (tile.id !== lastTileIdRef.current[i]) {
        lastTileIdRef.current[i] = tile.id
        lastObstacleTypeRef.current[i] = tile.obstacleType

        // Floor visibility (hidden for gap)
        const floor = floorMeshRefs.current[i]
        if (floor) {
          floor.visible = tile.obstacleType !== ObstacleType.GAP
        }

        // Narrowing walls
        const nw = narrowingMeshRefs.current[i]
        const isNarrowing = tile.obstacleType === ObstacleType.NARROWING
        if (nw[0]) nw[0].visible = isNarrowing
        if (nw[1]) nw[1].visible = isNarrowing

        // Spike group
        const sg = spikeGroupRefs.current[i]
        if (sg) {
          sg.visible = tile.obstacleType === ObstacleType.SPIKE
          // Reposition child spikes for the new gap
          if (tile.obstacleType === ObstacleType.SPIKE) {
            const spikeXPositions = [-2.25, -0.75, 0.75, 2.25]
            for (let s = 0; s < 4; s++) {
              const cx = spikeXPositions[s]
              const inGap = cx >= tile.spikeGapX - 1 && cx <= tile.spikeGapX + 1
              const child = sg.children[s] as THREE.Mesh
              if (child) {
                child.position.x = cx
                child.visible = !inGap
              }
            }
          }
        }

        // Speed pad mesh
        const sp = speedPadMeshRefs.current[i]
        if (sp) {
          sp.visible = tile.obstacleType === ObstacleType.SPEED_PAD
        }
      }

      // Tile fade-in: lerp opacity toward 1
      const floorMesh = floorMeshRefs.current[i]
      if (floorMesh) {
        const mat = floorMesh.material as THREE.MeshStandardMaterial
        if (mat && mat.opacity < 1) {
          mat.opacity = Math.min(1, mat.opacity + delta * 3)
        }
      }
    }

    // Update emissive only on tier change
    if (tierColorRef.current !== lastTierColorRef.current) {
      lastTierColorRef.current = tierColorRef.current
      const color = new THREE.Color(tierColorRef.current)
      for (let i = 0; i < TILE_COUNT; i++) {
        const mats = edgeMaterialRefs.current[i]
        for (let m = 0; m < mats.length; m++) {
          const mat = mats[m]
          if (mat) {
            mat.emissive = color
            if (m > 0) {
              mat.color = color
            }
          }
        }
      }
    }
  })

  return (
    <>
      {Array.from({ length: TILE_COUNT }, (_, i) => {
        const tile = tilesRef.current[i]
        const isGap = tile.obstacleType === ObstacleType.GAP
        const isNarrowing = tile.obstacleType === ObstacleType.NARROWING
        const isSpike = tile.obstacleType === ObstacleType.SPIKE
        const spikeXPositions = [-2.25, -0.75, 0.75, 2.25]
        return (
          <group
            key={tile.id}
            ref={(el) => { groupRefs.current[i] = el }}
            position={[0, 0, tile.z]}
          >
            {/* Surface — hidden for gap tiles */}
            <mesh
              ref={(el) => {
                floorMeshRefs.current[i] = el
                // Keep TileData meshRef in sync with what R3F assigns
                tile.meshRef.current = el
              }}
              receiveShadow
              visible={!isGap}
            >
              <boxGeometry args={[TILE_WIDTH, TILE_HEIGHT, TILE_DEPTH]} />
              <meshStandardMaterial
                ref={(el) => { edgeMaterialRefs.current[i][0] = el }}
                color={TILE_SURFACE_COLOR}
                emissive={tierColorRef.current}
                emissiveIntensity={0.4}
                transparent
                opacity={1}
              />
            </mesh>
            {/* Left edge */}
            <mesh
              position={[
                -TILE_WIDTH / 2 + EDGE_THICKNESS / 2,
                TILE_HEIGHT / 2 + EDGE_HEIGHT / 2,
                0,
              ]}
            >
              <boxGeometry args={[EDGE_THICKNESS, EDGE_HEIGHT, TILE_DEPTH]} />
              <meshStandardMaterial
                ref={(el) => { edgeMaterialRefs.current[i][1] = el }}
                color={tierColorRef.current}
                emissive={tierColorRef.current}
                emissiveIntensity={1.2}
              />
            </mesh>
            {/* Right edge */}
            <mesh
              position={[
                TILE_WIDTH / 2 - EDGE_THICKNESS / 2,
                TILE_HEIGHT / 2 + EDGE_HEIGHT / 2,
                0,
              ]}
            >
              <boxGeometry args={[EDGE_THICKNESS, EDGE_HEIGHT, TILE_DEPTH]} />
              <meshStandardMaterial
                ref={(el) => { edgeMaterialRefs.current[i][2] = el }}
                color={tierColorRef.current}
                emissive={tierColorRef.current}
                emissiveIntensity={1.2}
              />
            </mesh>
            {/* Narrowing walls */}
            <mesh
              ref={(el) => { narrowingMeshRefs.current[i][0] = el }}
              position={[-(NARROWING_HALF + NARROWING_WALL_WIDTH / 2), TILE_HEIGHT / 2 + 0.6, 0]}
              visible={isNarrowing}
            >
              <boxGeometry args={[NARROWING_WALL_WIDTH, 1.2, TILE_DEPTH]} />
              <meshStandardMaterial color="#ff3333" emissive="#ff0000" emissiveIntensity={0.8} />
            </mesh>
            <mesh
              ref={(el) => { narrowingMeshRefs.current[i][1] = el }}
              position={[(NARROWING_HALF + NARROWING_WALL_WIDTH / 2), TILE_HEIGHT / 2 + 0.6, 0]}
              visible={isNarrowing}
            >
              <boxGeometry args={[NARROWING_WALL_WIDTH, 1.2, TILE_DEPTH]} />
              <meshStandardMaterial color="#ff3333" emissive="#ff0000" emissiveIntensity={0.8} />
            </mesh>
            {/* Spike row */}
            <group
              ref={(el) => { spikeGroupRefs.current[i] = el }}
              visible={isSpike}
            >
              {spikeXPositions.map((cx, si) => {
                const inGap = cx >= tile.spikeGapX - 1 && cx <= tile.spikeGapX + 1
                return (
                  <mesh
                    key={si}
                    position={[cx, TILE_HEIGHT / 2 + SPIKE_HEIGHT / 2, 0]}
                    rotation={[-Math.PI / 2, 0, 0]}
                    visible={isSpike && !inGap}
                  >
                    <coneGeometry args={[SPIKE_RADIUS, SPIKE_HEIGHT, 4]} />
                    <meshStandardMaterial color="#ff6600" emissive="#ff3300" emissiveIntensity={1.0} metalness={0.6} roughness={0.3} />
                  </mesh>
                )
              })}
            </group>
            {/* Speed pad — flat cyan glowing plate (collectible, no death collision) */}
            <mesh
              ref={(el) => { speedPadMeshRefs.current[i] = el }}
              position={[0, TILE_HEIGHT / 2 + 0.1, 0]}
              visible={tile.obstacleType === ObstacleType.SPEED_PAD}
            >
              <boxGeometry args={[2, 0.1, 2]} />
              <meshStandardMaterial
                color="#00FFFF"
                emissive="#00FFFF"
                emissiveIntensity={0.8}
                roughness={0.1}
                metalness={0.3}
              />
            </mesh>
          </group>
        )
      })}
    </>
  )
}

// ---------------------------------------------------------------------------
// Fragment type for death shatter
// ---------------------------------------------------------------------------
interface FragmentData {
  mesh: THREE.Mesh
  vx: number
  vy: number
  vz: number
  elapsed: number
}

// ---------------------------------------------------------------------------
// Ball + Fragments
// ---------------------------------------------------------------------------
interface BallProps {
  xRef: React.MutableRefObject<number>
  yRef: React.MutableRefObject<number>
  zRef: React.MutableRefObject<number>
  tierColorRef: React.MutableRefObject<string>
  phaseRef: React.MutableRefObject<GamePhaseType>
  fragmentsRef: React.MutableRefObject<FragmentData[]>
  ballMeshRef: React.MutableRefObject<THREE.Mesh | null>
}

function Ball({ xRef, yRef, zRef, tierColorRef, phaseRef, fragmentsRef, ballMeshRef }: BallProps) {
  const meshRef = useRef<THREE.Mesh>(null)
  const lightRef = useRef<THREE.PointLight>(null)
  const fragmentGroupRef = useRef<THREE.Group>(null)
  const lastTierColorRef = useRef<string>(tierColorRef.current)
  const wasAlive = useRef<boolean>(true)

  // Sync external ref so GameLoop can drive roll rotation
  useEffect(() => {
    if (meshRef.current) {
      ballMeshRef.current = meshRef.current
    }
  })

  useFrame((_state, delta) => {
    const isDead = phaseRef.current === GamePhase.DEAD

    if (!isDead) {
      wasAlive.current = true
      if (meshRef.current) {
        meshRef.current.visible = true
        meshRef.current.position.x = xRef.current
        meshRef.current.position.y = yRef.current
        meshRef.current.position.z = zRef.current
      }
      if (lightRef.current) {
        lightRef.current.visible = true
        lightRef.current.position.x = xRef.current
        lightRef.current.position.y = yRef.current + 0.5
        lightRef.current.position.z = zRef.current
      }
    } else {
      // On first death frame: create fragments
      if (wasAlive.current) {
        wasAlive.current = false
        // Hide ball
        if (meshRef.current) meshRef.current.visible = false
        if (lightRef.current) lightRef.current.visible = false

        // Spawn fragments
        const group = fragmentGroupRef.current
        if (group) {
          // Dispose GPU resources for old fragments before clearing
          for (const f of fragmentsRef.current) {
            f.mesh.geometry.dispose()
            ;(f.mesh.material as THREE.Material).dispose()
          }
          // Clear old fragments from scene
          while (group.children.length > 0) {
            group.remove(group.children[0])
          }
          fragmentsRef.current = []

          const geo = new THREE.SphereGeometry(FRAGMENT_RADIUS, 8, 8)
          for (let f = 0; f < FRAGMENT_COUNT; f++) {
            const mat = new THREE.MeshStandardMaterial({
              color: '#ccccdd',
              metalness: 0.9,
              roughness: 0.1,
              transparent: true,
              opacity: 1,
            })
            const mesh = new THREE.Mesh(geo, mat)
            mesh.position.set(xRef.current, yRef.current, zRef.current)
            group.add(mesh)
            fragmentsRef.current.push({
              mesh,
              vx: (Math.random() - 0.5) * 8,
              vy: 2 + Math.random() * 6,
              vz: (Math.random() - 0.5) * 8,
              elapsed: 0,
            })
          }
        }
      }

      // Animate fragments
      const clampedDelta = Math.min(delta, 0.05)
      const frags = fragmentsRef.current
      for (let fi = 0; fi < frags.length; fi++) {
        const f = frags[fi]
        f.elapsed += clampedDelta * 1000 // ms
        f.vy -= 9.8 * clampedDelta
        f.mesh.position.x += f.vx * clampedDelta
        f.mesh.position.y += f.vy * clampedDelta
        f.mesh.position.z += f.vz * clampedDelta

        // Fade out after 600ms over 200ms
        if (f.elapsed > 600) {
          const fadeProgress = Math.min((f.elapsed - 600) / 200, 1)
          const mat = f.mesh.material as THREE.MeshStandardMaterial
          mat.opacity = 1 - fadeProgress
        }
      }
    }

    // Update light color on tier change only
    if (tierColorRef.current !== lastTierColorRef.current) {
      lastTierColorRef.current = tierColorRef.current
      if (lightRef.current) {
        lightRef.current.color = new THREE.Color(tierColorRef.current)
      }
    }
  })

  return (
    <>
      <mesh ref={meshRef} position={[0, BALL_Y, 0]} castShadow>
        <sphereGeometry args={[BALL_RADIUS, 32, 32]} />
        <meshStandardMaterial
          color="#ccccdd"
          metalness={0.85}
          roughness={0.15}
          emissive={tierColorRef.current}
          emissiveIntensity={0.3}
        />
      </mesh>
      <pointLight
        ref={lightRef}
        position={[0, BALL_Y + 0.5, 0]}
        color={tierColorRef.current}
        intensity={4}
        distance={8}
        decay={2}
      />
      <group ref={fragmentGroupRef} />
    </>
  )
}

// ---------------------------------------------------------------------------
// Camera controller with screen shake
// ---------------------------------------------------------------------------
interface CameraControllerProps {
  xRef: React.MutableRefObject<number>
  zRef: React.MutableRefObject<number>
  shakeRef: React.MutableRefObject<{ active: boolean; elapsed: number }>
}

function CameraController({ xRef, zRef, shakeRef }: CameraControllerProps) {
  const { camera } = useThree()

  useFrame((_state, delta) => {
    const targetX = xRef.current * CAM_X_FACTOR
    camera.position.x += (targetX - camera.position.x) * CAM_X_LERP
    camera.position.y = CAM_Y
    camera.position.z = zRef.current + CAM_Z_OFFSET
    camera.lookAt(xRef.current * 0.2, 0, zRef.current - 10)

    // Screen shake
    const shake = shakeRef.current
    if (shake.active) {
      const clampedDelta = Math.min(delta, 0.05)
      shake.elapsed += clampedDelta
      if (shake.elapsed >= 0.3) {
        shake.active = false
      } else {
        const mag = 0.3 * (1 - shake.elapsed / 0.3)
        camera.position.x += Math.sin(shake.elapsed * 80) * mag
        camera.position.y += Math.cos(shake.elapsed * 60) * mag * 0.5
      }
    }
  })

  return null
}

// ---------------------------------------------------------------------------
// Game loop — all physics ticked here
// ---------------------------------------------------------------------------
interface GameLoopProps {
  gameState: ReturnType<typeof useGameState>
  ball: ReturnType<typeof useBallPhysics>['ball']
  keysRef: ReturnType<typeof useBallPhysics>['keysRef']
  tilesRef: React.MutableRefObject<TileData[]>
  tileGenIndexRef: React.MutableRefObject<number>
  tierColorRef: React.MutableRefObject<string>
  onDeath: () => void
  ballMeshRef: React.MutableRefObject<THREE.Mesh | null>
  audioSetTier: (tier: SpeedTier) => void
  audioTriggerTierUp: () => void
  audioTriggerObstacle: (type: string) => void
  audioSetFilterCutoff: (hz: number) => void
}

function GameLoop({
  gameState,
  ball,
  keysRef,
  tilesRef,
  tileGenIndexRef,
  tierColorRef,
  onDeath,
  ballMeshRef,
  audioSetTier,
  audioTriggerTierUp,
  audioTriggerObstacle,
  audioSetFilterCutoff,
}: GameLoopProps) {
  // Track the last tile ID that triggered a narrowing audio event (fire once per tile)
  const lastNarrowingTriggerRef = useRef<number>(-1)
  // Track the last tile ID that triggered a spike audio event (fire once per tile)
  const lastSpikeTriggerRef = useRef<number>(-1)
  // Track collected speed pad tile IDs (reset on restart via tile ID recycling)
  const collectedSpeedPadsRef = useRef<Set<number>>(new Set())

  useFrame((_state, delta) => {
    // Only run physics when alive
    if (gameState.phaseRef.current !== GamePhase.PLAYING) return

    const clampedDelta = Math.min(delta, 0.05)

    // 1. Update game state (speed, distance, tier)
    const tierChanged = tickGameState(gameState, clampedDelta)
    if (tierChanged) {
      tierColorRef.current = getTierColor(gameState.tierRef.current)
      audioSetTier(gameState.tierRef.current)
      audioTriggerTierUp()
    }

    // 1b. Speed-to-filter-cutoff mapping — called every frame
    const speed = gameState.speedRef.current
    const cutoff = 400 + (speed - INITIAL_SPEED) / (MAX_SPEED - INITIAL_SPEED) * (8000 - 400)
    audioSetFilterCutoff(Math.max(400, Math.min(8000, cutoff)))

    // 2. Check if over gap for gravity
    const overGap = isBallOverGap(tilesRef.current, ball.xRef.current, ball.zRef.current)

    // 3. Advance ball physics
    tickBallPhysics(ball, keysRef, gameState.speedRef.current, clampedDelta, overGap)

    // 4. Recycle tiles
    tickTileEngine(tilesRef, tileGenIndexRef, ball.zRef.current)

    // 5. Ball roll animation
    if (ballMeshRef.current) {
      ballMeshRef.current.rotation.x += gameState.speedRef.current * clampedDelta * 0.3
    }

    // 5b. Obstacle audio triggers + speed pad collection
    const bzA = ball.zRef.current
    for (const tile of tilesRef.current) {
      const halfD = TILE_DEPTH / 2
      const inTileZ = bzA >= tile.z - halfD && bzA <= tile.z + halfD

      if (tile.obstacleType === ObstacleType.NARROWING && inTileZ) {
        if (lastNarrowingTriggerRef.current !== tile.id) {
          lastNarrowingTriggerRef.current = tile.id
          audioTriggerObstacle('narrowing')
        }
      } else if (tile.obstacleType === ObstacleType.SPIKE && inTileZ) {
        if (lastSpikeTriggerRef.current !== tile.id) {
          lastSpikeTriggerRef.current = tile.id
          audioTriggerObstacle('spike')
        }
      } else if (tile.obstacleType === ObstacleType.SPEED_PAD && inTileZ) {
        if (!collectedSpeedPadsRef.current.has(tile.id)) {
          collectedSpeedPadsRef.current.add(tile.id)
          // Boost speed, cap at MAX_SPEED
          gameState.speedRef.current = Math.min(
            gameState.speedRef.current + 3,
            MAX_SPEED,
          )
          audioTriggerObstacle('speed_pad')
        }
      }
    }

    // 6. Death detection
    const bx = ball.xRef.current
    const by = ball.yRef.current
    const bz = ball.zRef.current

    // Gap death: ball fell below threshold
    if (by < DEATH_Y) {
      onDeath()
      return
    }

    // Narrowing wall collision
    const tiles = tilesRef.current
    for (const tile of tiles) {
      if (tile.obstacleType !== ObstacleType.NARROWING) continue
      const halfD = TILE_DEPTH / 2
      if (bz >= tile.z - halfD && bz <= tile.z + halfD) {
        if (Math.abs(bx) > NARROWING_DEATH_X) {
          onDeath()
          return
        }
      }
    }

    // Spike collision: sphere-vs-expanded-AABB (boxes are in tile-local z space)
    for (const tile of tiles) {
      if (tile.obstacleType !== ObstacleType.SPIKE) continue
      // Only check tiles in z range [ballZ-1, ballZ+5]
      if (tile.z < bz - 1 || tile.z > bz + 5) continue
      for (const box of tile.obstacleBoxes) {
        // Offset local z bounds by tile world z
        const worldMinZ = tile.z + box.minZ
        const worldMaxZ = tile.z + box.maxZ
        if (
          bx >= box.minX - BALL_RADIUS &&
          bx <= box.maxX + BALL_RADIUS &&
          bz >= worldMinZ - BALL_RADIUS &&
          bz <= worldMaxZ + BALL_RADIUS
        ) {
          onDeath()
          return
        }
      }
    }
  })

  return null
}

// ---------------------------------------------------------------------------
// HUD overlay (in-game only)
// ---------------------------------------------------------------------------
interface HUDProps {
  distanceRef: React.MutableRefObject<number>
  tierRef: React.MutableRefObject<SpeedTier>
  bestRef: React.MutableRefObject<number>
  phaseRef: React.MutableRefObject<GamePhaseType>
}

function HUD({ distanceRef, tierRef, bestRef, phaseRef }: HUDProps) {
  const distElRef = useRef<HTMLSpanElement>(null)
  const bestElRef = useRef<HTMLSpanElement>(null)
  const tierDotRef = useRef<HTMLSpanElement>(null)
  const tierLabelRef = useRef<HTMLSpanElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    let rafId: number
    const update = () => {
      const phase = phaseRef.current
      if (phase === GamePhase.PLAYING) {
        if (distElRef.current) {
          distElRef.current.textContent = Math.floor(distanceRef.current) + 'm'
        }
        if (bestElRef.current) {
          bestElRef.current.textContent = 'BEST ' + bestRef.current + 'm'
        }
        const color = getTierColor(tierRef.current)
        const label = getTierLabel(tierRef.current)
        if (tierDotRef.current) {
          tierDotRef.current.style.background = color
          tierDotRef.current.style.boxShadow = `0 0 8px ${color}`
        }
        if (tierLabelRef.current) {
          tierLabelRef.current.textContent = label
          tierLabelRef.current.style.color = color
        }
      }
      if (containerRef.current) {
        containerRef.current.style.display = phase === GamePhase.PLAYING ? 'block' : 'none'
      }
      rafId = requestAnimationFrame(update)
    }
    rafId = requestAnimationFrame(update)
    return () => cancelAnimationFrame(rafId)
  }, [distanceRef, tierRef, bestRef, phaseRef])

  return (
    <div ref={containerRef} style={{
      position: 'absolute',
      top: 0,
      left: 0,
      width: '100%',
      height: '100%',
      pointerEvents: 'none',
      zIndex: 10,
      fontFamily: 'monospace',
    }}>
      {/* Distance — top center */}
      <div style={{
        position: 'absolute',
        top: '16px',
        left: '50%',
        transform: 'translateX(-50%)',
        fontSize: '22px',
        fontWeight: 'bold',
        color: '#ffffff',
        textShadow: '0 0 10px rgba(255,255,255,0.6)',
        letterSpacing: '0.05em',
      }}>
        <span ref={distElRef}>0m</span>
      </div>

      {/* Personal best — top right */}
      <div style={{
        position: 'absolute',
        top: '16px',
        right: '16px',
        fontSize: '13px',
        color: '#888888',
        letterSpacing: '0.05em',
      }}>
        <span ref={bestElRef}>BEST 0m</span>
      </div>

      {/* Speed tier — bottom center */}
      <div style={{
        position: 'absolute',
        bottom: '20px',
        left: '50%',
        transform: 'translateX(-50%)',
        display: 'flex',
        alignItems: 'center',
        gap: '8px',
        fontSize: '13px',
        letterSpacing: '0.1em',
      }}>
        <span
          ref={tierDotRef}
          style={{
            display: 'inline-block',
            width: '10px',
            height: '10px',
            borderRadius: '50%',
            background: '#7c3aed',
            boxShadow: '0 0 8px #7c3aed',
          }}
        />
        <span ref={tierLabelRef} style={{ color: '#7c3aed' }}>NOVICE</span>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Start screen overlay
// ---------------------------------------------------------------------------
interface StartScreenProps {
  onStart: () => void
}

function StartScreen({ onStart }: StartScreenProps) {
  return (
    <div
      role="dialog"
      aria-label="Slope Rush start screen"
      style={{
        position: 'absolute',
        top: 0,
        left: 0,
        width: '100%',
        height: '100%',
        background: '#0a0010',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        fontFamily: 'monospace',
        zIndex: 30,
        userSelect: 'none',
        cursor: 'pointer',
      }}
      onClick={onStart}
    >
      {/* Title */}
      <div style={{
        fontSize: 'clamp(40px, 8vw, 72px)',
        fontWeight: 'bold',
        letterSpacing: '0.08em',
        background: 'linear-gradient(135deg, #7c3aed 0%, #06b6d4 40%, #ec4899 80%, #ffffff 100%)',
        WebkitBackgroundClip: 'text',
        WebkitTextFillColor: 'transparent',
        backgroundClip: 'text',
        marginBottom: '4px',
        textShadow: 'none',
      }}>
        SLOPE RUSH
      </div>

      {/* Subtitle tier */}
      <div style={{
        fontSize: '14px',
        letterSpacing: '0.3em',
        color: '#7c3aed',
        textTransform: 'uppercase',
        marginBottom: '32px',
      }}>
        NOVICE → GODSPEED
      </div>

      {/* Preview ball canvas */}
      <div style={{ marginBottom: '36px', borderRadius: '8px', overflow: 'hidden', background: 'transparent' }}>
        <Canvas
          style={{ width: 100, height: 100, display: 'block' }}
          camera={{ position: [0, 0, 3], fov: 40 }}
          gl={{ alpha: true, antialias: true }}
        >
          <ambientLight intensity={0.5} />
          <directionalLight position={[3, 3, 3]} intensity={1.2} />
          <pointLight position={[-2, 2, 2]} color="#7c3aed" intensity={3} />
          <PreviewBall />
        </Canvas>
      </div>

      {/* CTA */}
      <div style={{
        fontSize: '15px',
        letterSpacing: '0.2em',
        color: '#ffffff',
        opacity: 0.8,
        animation: 'pulse 2s ease-in-out infinite',
      }}>
        PRESS SPACE / TAP TO PLAY
      </div>

      <style>{`
        @keyframes pulse {
          0%, 100% { opacity: 0.8; }
          50% { opacity: 0.3; }
        }
        @media (prefers-reduced-motion: reduce) {
          @keyframes pulse { 0%, 100% { opacity: 0.8; } }
        }
      `}</style>
    </div>
  )
}

// Preview ball for start screen — auto-rotating metallic sphere
function PreviewBall() {
  const meshRef = useRef<THREE.Mesh>(null)

  useFrame((_state, delta) => {
    if (meshRef.current) {
      meshRef.current.rotation.y += delta * 0.8
      meshRef.current.rotation.x += delta * 0.3
    }
  })

  return (
    <mesh ref={meshRef}>
      <sphereGeometry args={[0.7, 32, 32]} />
      <meshStandardMaterial
        color="#ccccdd"
        metalness={0.85}
        roughness={0.15}
        emissive="#7c3aed"
        emissiveIntensity={0.4}
      />
    </mesh>
  )
}

// ---------------------------------------------------------------------------
// Dead overlay
// ---------------------------------------------------------------------------
interface DeadOverlayProps {
  score: number
  best: number
  isNewBest: boolean
  tierColor: string
  onRestart: () => void
  visible: boolean
}

function DeadOverlay({ score, best, isNewBest, tierColor, onRestart, visible }: DeadOverlayProps) {
  if (!visible) return null

  return (
    <div
      role="dialog"
      aria-label="Game over"
      style={{
        position: 'absolute',
        top: 0,
        left: 0,
        width: '100%',
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        background: 'rgba(10,0,16,0.85)',
        color: '#ffffff',
        fontFamily: 'monospace',
        zIndex: 20,
        userSelect: 'none',
      }}
    >
      {/* GAME OVER heading */}
      <div style={{
        fontSize: 'clamp(36px, 7vw, 56px)',
        fontWeight: 'bold',
        letterSpacing: '0.1em',
        color: '#ec4899',
        textShadow: '0 0 20px #ec4899, 0 0 40px #ec4899',
        marginBottom: '20px',
        animation: 'flicker 0.5s ease-in',
      }}>
        GAME OVER
      </div>

      {/* Distance achieved */}
      <div style={{
        fontSize: '28px',
        fontWeight: 'bold',
        marginBottom: '8px',
        color: '#ffffff',
      }}>
        {score}m
      </div>

      {/* New best badge */}
      {isNewBest && (
        <div style={{
          fontSize: '14px',
          letterSpacing: '0.2em',
          color: '#fbbf24',
          textShadow: '0 0 12px #fbbf24',
          marginBottom: '8px',
          animation: 'newBest 0.4s ease-out',
          fontWeight: 'bold',
        }}>
          NEW BEST!
        </div>
      )}

      {/* Previous best */}
      {!isNewBest && (
        <div style={{
          fontSize: '14px',
          color: '#888',
          marginBottom: '8px',
        }}>
          BEST {best}m
        </div>
      )}

      {/* Spacing */}
      <div style={{ marginBottom: '32px' }} />

      {/* Play again button */}
      <button
        onClick={onRestart}
        style={{
          padding: '14px 36px',
          fontSize: '15px',
          fontFamily: 'monospace',
          fontWeight: 'bold',
          letterSpacing: '0.15em',
          color: '#ffffff',
          background: 'transparent',
          border: `2px solid ${tierColor}`,
          borderRadius: '4px',
          cursor: 'pointer',
          boxShadow: `0 0 16px ${tierColor}`,
          textShadow: `0 0 8px ${tierColor}`,
          transition: 'none',
        }}
      >
        PLAY AGAIN
      </button>

      <style>{`
        @keyframes flicker {
          0% { opacity: 0; transform: scale(1.1); }
          40% { opacity: 1; }
          60% { opacity: 0.8; }
          100% { opacity: 1; transform: scale(1); }
        }
        @keyframes newBest {
          0% { opacity: 0; transform: translateY(-10px) scale(0.8); }
          100% { opacity: 1; transform: translateY(0) scale(1); }
        }
        @media (prefers-reduced-motion: reduce) {
          @keyframes flicker { 0%, 100% { opacity: 1; } }
          @keyframes newBest { 0%, 100% { opacity: 1; } }
        }
      `}</style>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Scene root — composes everything inside the Canvas
// ---------------------------------------------------------------------------
interface SceneProps {
  gameState: ReturnType<typeof useGameState>
  ball: ReturnType<typeof useBallPhysics>['ball']
  keysRef: ReturnType<typeof useBallPhysics>['keysRef']
  tilesRef: React.MutableRefObject<TileData[]>
  tileGenIndexRef: React.MutableRefObject<number>
  tierColorRef: React.MutableRefObject<string>
  onDeath: () => void
  fragmentsRef: React.MutableRefObject<FragmentData[]>
  shakeRef: React.MutableRefObject<{ active: boolean; elapsed: number }>
  ballMeshRef: React.MutableRefObject<THREE.Mesh | null>
  audioSetTier: (tier: SpeedTier) => void
  audioTriggerTierUp: () => void
  audioTriggerObstacle: (type: string) => void
  audioSetFilterCutoff: (hz: number) => void
  constellationDataRef: React.MutableRefObject<ConstellationEntry[]>
  newConstellationRef: React.MutableRefObject<ConstellationEntry | null>
  bloomRef: React.MutableRefObject<BloomState>
}

function Scene({
  gameState,
  ball,
  keysRef,
  tilesRef,
  tileGenIndexRef,
  tierColorRef,
  onDeath,
  fragmentsRef,
  shakeRef,
  ballMeshRef,
  audioSetTier,
  audioTriggerTierUp,
  audioTriggerObstacle,
  audioSetFilterCutoff,
  constellationDataRef,
  newConstellationRef,
  bloomRef,
}: SceneProps) {
  return (
    <>
      <color attach="background" args={[BG_COLOR]} />
      <fogExp2 attach="fog" args={[BG_COLOR, FOG_DENSITY]} />

      <ambientLight intensity={0.3} />
      <directionalLight position={[5, 10, 5]} intensity={0.8} castShadow />

      <Starfield />
      <Constellations
        constellationDataRef={constellationDataRef}
        newConstellationRef={newConstellationRef}
      />
      <BloomParticles bloomRef={bloomRef} />
      <Track tilesRef={tilesRef} tierColorRef={tierColorRef} />
      <Ball
        xRef={ball.xRef}
        yRef={ball.yRef}
        zRef={ball.zRef}
        tierColorRef={tierColorRef}
        phaseRef={gameState.phaseRef}
        fragmentsRef={fragmentsRef}
        ballMeshRef={ballMeshRef}
      />
      <CameraController xRef={ball.xRef} zRef={ball.zRef} shakeRef={shakeRef} />
      <GameLoop
        gameState={gameState}
        ball={ball}
        keysRef={keysRef}
        tilesRef={tilesRef}
        tileGenIndexRef={tileGenIndexRef}
        tierColorRef={tierColorRef}
        onDeath={onDeath}
        ballMeshRef={ballMeshRef}
        audioSetTier={audioSetTier}
        audioTriggerTierUp={audioTriggerTierUp}
        audioTriggerObstacle={audioTriggerObstacle}
        audioSetFilterCutoff={audioSetFilterCutoff}
      />
    </>
  )
}

// ---------------------------------------------------------------------------
// App root — keyboard listeners live here, outside Canvas
// ---------------------------------------------------------------------------
export default function App() {
  const gameState = useGameState()
  const { ball, keysRef } = useBallPhysics()
  const { tilesRef, tileGenIndexRef } = useTileEngine()
  const tierColorRef = useRef<string>(getTierColor(gameState.tierRef.current))
  const fragmentsRef = useRef<FragmentData[]>([])
  const shakeRef = useRef<{ active: boolean; elapsed: number }>({ active: false, elapsed: 0 })
  const ballMeshRef = useRef<THREE.Mesh | null>(null)

  const audio = useAudio()

  // Phase drives overlay visibility (React state so it re-renders)
  const [phase, setUiPhase] = useState<GamePhaseType>(GamePhase.IDLE)
  // Snapshot score/best at death time so overlay renders without ref access
  const [deadScore, setDeadScore] = useState<number>(0)
  const [deadBest, setDeadBest] = useState<number>(0)
  const [isNewBest, setIsNewBest] = useState<boolean>(false)
  const [deadTierColor, setDeadTierColor] = useState<string>('#ec4899')

  // Constellation refs — data lives here, Constellations component reads them
  const constellationDataRef = useRef<ConstellationEntry[]>([])
  const newConstellationRef = useRef<ConstellationEntry | null>(null)

  // Bloom ref — particle burst on PB-beating death
  const bloomRef = useRef<BloomState>({
    active: false,
    elapsed: 0,
    deathPos: new THREE.Vector3(),
    color: '#7c3aed',
    particles: [],
  })

  // Personal best — read from localStorage on mount
  const bestRef = useRef<number>(0)
  useEffect(() => {
    const stored = localStorage.getItem(BEST_KEY)
    if (stored) {
      const parsed = parseInt(stored, 10)
      if (!isNaN(parsed)) bestRef.current = parsed
    }
  }, [])

  const startGame = useCallback(() => {
    if (gameState.phaseRef.current !== GamePhase.IDLE) return

    // AudioContext MUST be created inside user-gesture handler
    audio.startAudio()

    gameState.setPhase(GamePhase.PLAYING)
    setUiPhase(GamePhase.PLAYING)
  }, [gameState, audio])

  const handleDeath = useCallback(() => {
    gameState.setPhase(GamePhase.DEAD)
    audio.stopAudio()
    audio.triggerDeath()

    // Trigger screen shake
    shakeRef.current = { active: true, elapsed: 0 }

    // Capture previous best BEFORE updating it
    const previousBest = bestRef.current

    // Update personal best
    const score = Math.floor(gameState.distanceRef.current)
    const newBest = score > bestRef.current
    if (newBest) {
      bestRef.current = score
      localStorage.setItem(BEST_KEY, score.toString())

      // Generate and persist constellation for this PB run
      const currentTier = gameState.tierRef.current
      const entry = generateConstellation(score, currentTier, previousBest)
      saveConstellation(entry)
      // Signal Constellations component to add it on the next frame
      newConstellationRef.current = entry

      // Trigger death bloom — load the freshly-saved entry (index 0)
      const savedEntry = loadConstellations()[0]
      if (savedEntry) {
        const deathX = ball.xRef.current
        const deathY = ball.yRef.current
        const deathZ = ball.zRef.current
        const particles = savedEntry.stars.map((star, i) => ({
          startX: deathX + i * 0.3,
          startY: deathY + i * 0.3,
          startZ: deathZ + i * 0.3,
          endX: star.x,
          endY: star.y,
          endZ: star.z,
        }))
        bloomRef.current = {
          active: true,
          elapsed: 0,
          deathPos: new THREE.Vector3(deathX, deathY, deathZ),
          color: getTierColor(gameState.tierRef.current),
          particles,
        }
      }
    } else {
      // Non-PB death — ensure bloom is inactive
      bloomRef.current.active = false
    }

    // Snapshot values for overlay render
    setDeadScore(score)
    setDeadBest(bestRef.current)
    setIsNewBest(newBest)
    setDeadTierColor(getTierColor(gameState.tierRef.current))
    setUiPhase(GamePhase.DEAD)
  }, [gameState, audio, newConstellationRef, ball])

  const handleRestart = useCallback(() => {
    // Reset ball via encapsulated function
    ball.resetBall()

    // Reset game state via encapsulated function
    gameState.resetState(INITIAL_SPEED)

    // Reset tier color
    tierColorRef.current = getTierColor(getSpeedTier(INITIAL_SPEED))

    // Reset tiles
    resetTileEngine(tilesRef, tileGenIndexRef)

    // Clear fragments (Ball component watches phaseRef for wasAlive reset)
    fragmentsRef.current = []

    // Reset shake
    shakeRef.current = { active: false, elapsed: 0 }

    // Cancel any active bloom
    bloomRef.current.active = false

    // Restart audio
    audio.startAudio()
    audio.setTier(1)

    // Resume game
    gameState.setPhase(GamePhase.PLAYING)
    setUiPhase(GamePhase.PLAYING)
  }, [ball, gameState, tilesRef, tileGenIndexRef, tierColorRef, audio])

  // Keyboard input — including restart on R and start on Space
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'ArrowLeft' || e.key === 'a' || e.key === 'A') {
        keysRef.current.left = true
      }
      if (e.key === 'ArrowRight' || e.key === 'd' || e.key === 'D') {
        keysRef.current.right = true
      }
      if (e.key === ' ') {
        if (gameState.phaseRef.current === GamePhase.IDLE) {
          startGame()
        }
        e.preventDefault()
      }
      if ((e.key === 'r' || e.key === 'R') && gameState.phaseRef.current === GamePhase.DEAD) {
        handleRestart()
      }
    }
    const onKeyUp = (e: KeyboardEvent) => {
      if (e.key === 'ArrowLeft' || e.key === 'a' || e.key === 'A') {
        keysRef.current.left = false
      }
      if (e.key === 'ArrowRight' || e.key === 'd' || e.key === 'D') {
        keysRef.current.right = false
      }
    }

    window.addEventListener('keydown', onKeyDown)
    window.addEventListener('keyup', onKeyUp)
    return () => {
      window.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('keyup', onKeyUp)
    }
  }, [keysRef, gameState, handleRestart, startGame])

  // Mobile touch controls
  useEffect(() => {
    const onTouchStart = (e: TouchEvent) => {
      // Don't queue steering input unless actively playing
      if (gameState.phaseRef.current !== GamePhase.PLAYING) return
      for (let i = 0; i < e.changedTouches.length; i++) {
        const touch = e.changedTouches[i]
        const halfW = window.innerWidth / 2
        if (touch.clientX < halfW) {
          keysRef.current.left = true
        } else {
          keysRef.current.right = true
        }
      }
    }

    const onTouchEnd = (e: TouchEvent) => {
      // Re-evaluate remaining touches to decide which directions are still active
      keysRef.current.left = false
      keysRef.current.right = false
      for (let i = 0; i < e.touches.length; i++) {
        const touch = e.touches[i]
        const halfW = window.innerWidth / 2
        if (touch.clientX < halfW) {
          keysRef.current.left = true
        } else {
          keysRef.current.right = true
        }
      }
    }

    document.addEventListener('touchstart', onTouchStart, { passive: true })
    document.addEventListener('touchend', onTouchEnd, { passive: true })
    return () => {
      document.removeEventListener('touchstart', onTouchStart)
      document.removeEventListener('touchend', onTouchEnd)
    }
  }, [keysRef, gameState])

  return (
    <div
      style={{ width: '100vw', height: '100vh', overflow: 'hidden', position: 'relative' }}
      role="application"
      aria-label="Slope Rush game"
    >
      {/* Start screen */}
      {phase === GamePhase.IDLE && (
        <StartScreen onStart={startGame} />
      )}

      {/* In-game HUD */}
      <HUD
        distanceRef={gameState.distanceRef}
        tierRef={gameState.tierRef}
        bestRef={bestRef}
        phaseRef={gameState.phaseRef}
      />

      {/* Main 3D canvas */}
      <Canvas
        camera={{ position: [0, CAM_Y, CAM_Z_OFFSET], fov: 75 }}
        shadows
        style={{ width: '100%', height: '100%' }}
      >
        <Scene
          gameState={gameState}
          ball={ball}
          keysRef={keysRef}
          tilesRef={tilesRef}
          tileGenIndexRef={tileGenIndexRef}
          tierColorRef={tierColorRef}
          onDeath={handleDeath}
          fragmentsRef={fragmentsRef}
          shakeRef={shakeRef}
          ballMeshRef={ballMeshRef}
          audioSetTier={audio.setTier}
          audioTriggerTierUp={audio.triggerTierUp}
          audioTriggerObstacle={audio.triggerObstacle}
          audioSetFilterCutoff={audio.setFilterCutoff}
          constellationDataRef={constellationDataRef}
          newConstellationRef={newConstellationRef}
          bloomRef={bloomRef}
        />
      </Canvas>

      {/* Game over overlay */}
      <DeadOverlay
        score={deadScore}
        best={deadBest}
        isNewBest={isNewBest}
        tierColor={deadTierColor}
        onRestart={handleRestart}
        visible={phase === GamePhase.DEAD}
      />
    </div>
  )
}
