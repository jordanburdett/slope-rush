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
  getSpeedTier,
  INITIAL_SPEED,
  NARROWING_HALF,
  NARROWING_WALL_WIDTH,
  SPIKE_RADIUS,
  SPIKE_HEIGHT,
  DEATH_Y,
  NARROWING_DEATH_X,
  FRAGMENT_COUNT,
  FRAGMENT_RADIUS,
  BEST_KEY,
  ObstacleType,
  GamePhase,
  type SpeedTier,
  type GamePhase as GamePhaseType,
} from './game/constants'
import { useGameState, tickGameState } from './game/useGameState'
import { useBallPhysics, tickBallPhysics } from './game/useBallPhysics'
import { useTileEngine, tickTileEngine, resetTileEngine, isBallOverGap } from './game/useTileEngine'
import type { TileData } from './game/useTileEngine'

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

  // Track which tile index had which obstacle last time we set it up
  const lastObstacleTypeRef = useRef<Array<string>>(
    Array.from({ length: TILE_COUNT }, () => 'none'),
  )
  const lastTileIdRef = useRef<Array<number>>(
    Array.from({ length: TILE_COUNT }, (_, i) => i),
  )

  // Keep tier color update separate from position update
  const lastTierColorRef = useRef<string>(tierColorRef.current)

  useFrame(() => {
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
              ref={(el) => { floorMeshRefs.current[i] = el }}
              receiveShadow
              visible={!isGap}
            >
              <boxGeometry args={[TILE_WIDTH, TILE_HEIGHT, TILE_DEPTH]} />
              <meshStandardMaterial
                ref={(el) => { edgeMaterialRefs.current[i][0] = el }}
                color={TILE_SURFACE_COLOR}
                emissive={tierColorRef.current}
                emissiveIntensity={0.4}
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
}

function Ball({ xRef, yRef, zRef, tierColorRef, phaseRef, fragmentsRef }: BallProps) {
  const meshRef = useRef<THREE.Mesh>(null)
  const lightRef = useRef<THREE.PointLight>(null)
  const fragmentGroupRef = useRef<THREE.Group>(null)
  const lastTierColorRef = useRef<string>(tierColorRef.current)
  const wasAlive = useRef<boolean>(true)

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
          // Clear old fragments
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
// Camera controller
// ---------------------------------------------------------------------------
interface CameraControllerProps {
  xRef: React.MutableRefObject<number>
  zRef: React.MutableRefObject<number>
}

function CameraController({ xRef, zRef }: CameraControllerProps) {
  const { camera } = useThree()

  useFrame(() => {
    const targetX = xRef.current * CAM_X_FACTOR
    camera.position.x += (targetX - camera.position.x) * CAM_X_LERP
    camera.position.y = CAM_Y
    camera.position.z = zRef.current + CAM_Z_OFFSET
    camera.lookAt(xRef.current * 0.2, 0, zRef.current - 10)
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
}

function GameLoop({
  gameState,
  ball,
  keysRef,
  tilesRef,
  tileGenIndexRef,
  tierColorRef,
  onDeath,
}: GameLoopProps) {
  useFrame((_state, delta) => {
    // Only run physics when alive
    if (gameState.phaseRef.current !== GamePhase.PLAYING) return

    const clampedDelta = Math.min(delta, 0.05)

    // 1. Update game state (speed, distance, tier)
    const tierChanged = tickGameState(gameState, clampedDelta)
    if (tierChanged) {
      tierColorRef.current = getTierColor(gameState.tierRef.current)
    }

    // 2. Check if over gap for gravity
    const overGap = isBallOverGap(tilesRef.current, ball.xRef.current, ball.zRef.current)

    // 3. Advance ball physics
    tickBallPhysics(ball, keysRef, gameState.speedRef.current, clampedDelta, overGap)

    // 4. Recycle tiles
    tickTileEngine(tilesRef, tileGenIndexRef, ball.zRef.current)

    // 5. Death detection
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
// HUD overlay
// ---------------------------------------------------------------------------
interface HUDProps {
  speedRef: React.MutableRefObject<number>
  distanceRef: React.MutableRefObject<number>
  tierRef: React.MutableRefObject<SpeedTier>
  bestRef: React.MutableRefObject<number>
  phaseRef: React.MutableRefObject<GamePhaseType>
}

function HUD({ speedRef, distanceRef, tierRef, bestRef, phaseRef }: HUDProps) {
  const hudRef = useRef<HTMLDivElement>(null)
  const speedElRef = useRef<HTMLSpanElement>(null)
  const distElRef = useRef<HTMLSpanElement>(null)
  const bestElRef = useRef<HTMLSpanElement>(null)
  const scoreElRef = useRef<HTMLSpanElement>(null)

  useEffect(() => {
    let rafId: number
    const update = () => {
      if (phaseRef.current !== GamePhase.DEAD) {
        if (speedElRef.current) {
          speedElRef.current.textContent = Math.round(speedRef.current).toString()
        }
        if (distElRef.current) {
          distElRef.current.textContent = Math.round(distanceRef.current) + 'm'
        }
        if (scoreElRef.current) {
          scoreElRef.current.textContent = Math.floor(distanceRef.current).toString()
        }
      }
      if (bestElRef.current) {
        bestElRef.current.textContent = bestRef.current.toString()
      }
      if (hudRef.current) {
        const color = getTierColor(tierRef.current)
        hudRef.current.style.setProperty('--tier-color', color)
      }
      rafId = requestAnimationFrame(update)
    }
    rafId = requestAnimationFrame(update)
    return () => cancelAnimationFrame(rafId)
  }, [speedRef, distanceRef, tierRef, bestRef, phaseRef])

  return (
    <div ref={hudRef} style={{
      position: 'absolute',
      top: 0,
      left: 0,
      width: '100%',
      padding: '12px 16px',
      boxSizing: 'border-box',
      display: 'flex',
      justifyContent: 'space-between',
      alignItems: 'flex-start',
      fontFamily: 'monospace',
      fontSize: '14px',
      color: '#ffffff',
      pointerEvents: 'none',
      zIndex: 10,
      textShadow: '0 0 8px var(--tier-color, #7c3aed)',
    }}>
      <span>SPD <span ref={speedElRef}>12</span></span>
      {/* Center score */}
      <span style={{
        position: 'absolute',
        left: '50%',
        transform: 'translateX(-50%)',
        fontSize: '18px',
        fontWeight: 'bold',
      }}>
        <span ref={scoreElRef}>0</span><span style={{ fontSize: '12px', marginLeft: '2px' }}>m</span>
      </span>
      <span>DIST <span ref={distElRef}>0m</span></span>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Dead overlay
// ---------------------------------------------------------------------------
interface DeadOverlayProps {
  score: number
  best: number
  onRestart: () => void
  visible: boolean
}

function DeadOverlay({ score, best, onRestart, visible }: DeadOverlayProps) {
  if (!visible) return null

  return (
    <div
      role="dialog"
      aria-label="Game over"
      onClick={onRestart}
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
        background: 'rgba(0,0,0,0.7)',
        color: '#ffffff',
        fontFamily: 'monospace',
        zIndex: 20,
        cursor: 'pointer',
        userSelect: 'none',
      }}
    >
      <div style={{ fontSize: '40px', fontWeight: 'bold', marginBottom: '12px', color: '#ec4899', textShadow: '0 0 20px #ec4899' }}>
        DEAD
      </div>
      <div style={{ fontSize: '20px', marginBottom: '8px' }}>
        Score: <strong>{score}m</strong>
      </div>
      <div style={{ fontSize: '16px', marginBottom: '32px', color: '#06b6d4' }}>
        Best: <strong>{best}m</strong>
      </div>
      <div style={{ fontSize: '14px', opacity: 0.7 }}>
        Press <strong>R</strong> or tap to restart
      </div>
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
}: SceneProps) {
  return (
    <>
      <color attach="background" args={[BG_COLOR]} />
      <fogExp2 attach="fog" args={[BG_COLOR, FOG_DENSITY]} />

      <ambientLight intensity={0.3} />
      <directionalLight position={[5, 10, 5]} intensity={0.8} castShadow />

      <Starfield />
      <Track tilesRef={tilesRef} tierColorRef={tierColorRef} />
      <Ball
        xRef={ball.xRef}
        yRef={ball.yRef}
        zRef={ball.zRef}
        tierColorRef={tierColorRef}
        phaseRef={gameState.phaseRef}
        fragmentsRef={fragmentsRef}
      />
      <CameraController xRef={ball.xRef} zRef={ball.zRef} />
      <GameLoop
        gameState={gameState}
        ball={ball}
        keysRef={keysRef}
        tilesRef={tilesRef}
        tileGenIndexRef={tileGenIndexRef}
        tierColorRef={tierColorRef}
        onDeath={onDeath}
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

  // Phase drives the dead overlay visibility (React state so it re-renders)
  const [phase, setUiPhase] = useState<GamePhaseType>(GamePhase.PLAYING)
  // Snapshot score/best at death time so overlay renders without ref access
  const [deadScore, setDeadScore] = useState<number>(0)
  const [deadBest, setDeadBest] = useState<number>(0)

  // Personal best — read from localStorage on mount
  const bestRef = useRef<number>(0)
  useEffect(() => {
    const stored = localStorage.getItem(BEST_KEY)
    if (stored) {
      const parsed = parseInt(stored, 10)
      if (!isNaN(parsed)) bestRef.current = parsed
    }
  }, [])

  const handleDeath = useCallback(() => {
    gameState.setPhase(GamePhase.DEAD)

    // Update personal best
    const score = Math.floor(gameState.distanceRef.current)
    if (score > bestRef.current) {
      bestRef.current = score
      localStorage.setItem(BEST_KEY, score.toString())
    }

    // Snapshot values for overlay render
    setDeadScore(score)
    setDeadBest(bestRef.current)
    setUiPhase(GamePhase.DEAD)
  }, [gameState])

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

    // Resume game
    gameState.setPhase(GamePhase.PLAYING)
    setUiPhase(GamePhase.PLAYING)
  }, [ball, gameState, tilesRef, tileGenIndexRef, tierColorRef])

  // Keyboard input — including restart on R
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'ArrowLeft' || e.key === 'a' || e.key === 'A') {
        keysRef.current.left = true
      }
      if (e.key === 'ArrowRight' || e.key === 'd' || e.key === 'D') {
        keysRef.current.right = true
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
  }, [keysRef, gameState, handleRestart])

  return (
    <div
      style={{ width: '100vw', height: '100vh', overflow: 'hidden', position: 'relative' }}
      role="application"
      aria-label="Slope Rush game"
    >
      <HUD
        speedRef={gameState.speedRef}
        distanceRef={gameState.distanceRef}
        tierRef={gameState.tierRef}
        bestRef={bestRef}
        phaseRef={gameState.phaseRef}
      />
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
        />
      </Canvas>
      <DeadOverlay
        score={deadScore}
        best={deadBest}
        onRestart={handleRestart}
        visible={phase === GamePhase.DEAD}
      />
    </div>
  )
}
