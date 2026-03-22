import { useEffect, useRef, useMemo } from 'react'
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
  type SpeedTier,
} from './game/constants'
import { useGameState, tickGameState } from './game/useGameState'
import { useBallPhysics, tickBallPhysics } from './game/useBallPhysics'
import { useTileEngine, tickTileEngine } from './game/useTileEngine'

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
// Track — rendered from tilesRef positions
// ---------------------------------------------------------------------------
interface TrackProps {
  tilesRef: React.MutableRefObject<Array<{ id: number; z: number }>>
  tierColorRef: React.MutableRefObject<string>
}

function Track({ tilesRef, tierColorRef }: TrackProps) {
  // Tile group refs so we can teleport them without React re-renders
  const groupRefs = useRef<Array<THREE.Group | null>>(
    Array.from({ length: TILE_COUNT }, () => null),
  )
  const edgeMaterialRefs = useRef<Array<Array<THREE.MeshStandardMaterial | null>>>(
    Array.from({ length: TILE_COUNT }, () => [null, null, null]),
  )

  // Keep tier color update separate from position update
  const lastTierColorRef = useRef<string>(tierColorRef.current)

  useFrame(() => {
    const tiles = tilesRef.current

    // Update positions every frame
    for (let i = 0; i < tiles.length; i++) {
      const group = groupRefs.current[i]
      if (group) {
        group.position.z = tiles[i].z
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
              // edge strips also change base color
              mat.color = color
            }
          }
        }
      }
    }
  })

  return (
    <>
      {Array.from({ length: TILE_COUNT }, (_, i) => (
        <group
          key={tilesRef.current[i].id}
          ref={(el) => { groupRefs.current[i] = el }}
          position={[0, 0, tilesRef.current[i].z]}
        >
          {/* Surface */}
          <mesh receiveShadow>
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
        </group>
      ))}
    </>
  )
}

// ---------------------------------------------------------------------------
// Ball
// ---------------------------------------------------------------------------
interface BallProps {
  xRef: React.MutableRefObject<number>
  zRef: React.MutableRefObject<number>
  tierColorRef: React.MutableRefObject<string>
}

function Ball({ xRef, zRef, tierColorRef }: BallProps) {
  const meshRef = useRef<THREE.Mesh>(null)
  const lightRef = useRef<THREE.PointLight>(null)
  const lastTierColorRef = useRef<string>(tierColorRef.current)

  useFrame(() => {
    if (meshRef.current) {
      meshRef.current.position.x = xRef.current
      meshRef.current.position.z = zRef.current
    }
    if (lightRef.current) {
      lightRef.current.position.x = xRef.current
      lightRef.current.position.z = zRef.current
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
  tilesRef: React.MutableRefObject<Array<{ id: number; z: number }>>
  tierColorRef: React.MutableRefObject<string>
}

function GameLoop({ gameState, ball, keysRef, tilesRef, tierColorRef }: GameLoopProps) {
  useFrame((_state, delta) => {
    const clampedDelta = Math.min(delta, 0.05) // cap at 50ms to avoid physics tunneling

    // 1. Update game state (speed, distance, tier)
    const tierChanged = tickGameState(gameState, clampedDelta)
    if (tierChanged) {
      tierColorRef.current = getTierColor(gameState.tierRef.current)
    }

    // 2. Advance ball physics
    tickBallPhysics(ball, keysRef, gameState.speedRef.current, clampedDelta)

    // 3. Recycle tiles
    tickTileEngine(tilesRef, ball.zRef.current)
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
}

function HUD({ speedRef, distanceRef, tierRef }: HUDProps) {
  const hudRef = useRef<HTMLDivElement>(null)
  const speedElRef = useRef<HTMLSpanElement>(null)
  const distElRef = useRef<HTMLSpanElement>(null)

  // Use a native rAF outside canvas to update HUD without R3F re-renders
  useEffect(() => {
    let rafId: number
    const update = () => {
      if (speedElRef.current) {
        speedElRef.current.textContent = Math.round(speedRef.current).toString()
      }
      if (distElRef.current) {
        distElRef.current.textContent = Math.round(distanceRef.current) + 'm'
      }
      if (hudRef.current) {
        const color = getTierColor(tierRef.current)
        hudRef.current.style.setProperty('--tier-color', color)
      }
      rafId = requestAnimationFrame(update)
    }
    rafId = requestAnimationFrame(update)
    return () => cancelAnimationFrame(rafId)
  }, [speedRef, distanceRef, tierRef])

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
      fontFamily: 'monospace',
      fontSize: '14px',
      color: '#ffffff',
      pointerEvents: 'none',
      zIndex: 10,
      textShadow: '0 0 8px var(--tier-color, #7c3aed)',
    }}>
      <span>SPD <span ref={speedElRef}>12</span></span>
      <span>DIST <span ref={distElRef}>0m</span></span>
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
  tilesRef: React.MutableRefObject<Array<{ id: number; z: number }>>
  tierColorRef: React.MutableRefObject<string>
}

function Scene({ gameState, ball, keysRef, tilesRef, tierColorRef }: SceneProps) {
  return (
    <>
      <color attach="background" args={[BG_COLOR]} />
      <fogExp2 attach="fog" args={[BG_COLOR, FOG_DENSITY]} />

      <ambientLight intensity={0.3} />
      <directionalLight position={[5, 10, 5]} intensity={0.8} castShadow />

      <Starfield />
      <Track tilesRef={tilesRef} tierColorRef={tierColorRef} />
      <Ball xRef={ball.xRef} zRef={ball.zRef} tierColorRef={tierColorRef} />
      <CameraController xRef={ball.xRef} zRef={ball.zRef} />
      <GameLoop
        gameState={gameState}
        ball={ball}
        keysRef={keysRef}
        tilesRef={tilesRef}
        tierColorRef={tierColorRef}
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
  const { tilesRef } = useTileEngine()
  const tierColorRef = useRef<string>(getTierColor(gameState.tierRef.current))

  // Keyboard input
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'ArrowLeft' || e.key === 'a' || e.key === 'A') {
        keysRef.current.left = true
      }
      if (e.key === 'ArrowRight' || e.key === 'd' || e.key === 'D') {
        keysRef.current.right = true
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
  }, [keysRef])

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
          tierColorRef={tierColorRef}
        />
      </Canvas>
    </div>
  )
}
