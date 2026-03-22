# Slope Rush — CLAUDE.md

## What This Is

Slope Rush is a neon ball-runner browser game built with React Three Fiber (R3F), Vite, and TypeScript. The ball rolls forward automatically; the player steers left/right to stay on the track.

## Build Commands

```bash
npm run dev      # dev server on http://localhost:5173
npm run build    # TypeScript check + production build (outputs to dist/)
npm run preview  # preview production build
npm run lint     # ESLint
npx vitest       # run unit tests
```

## Key Architecture

### File Layout

```
src/
  App.tsx              — Canvas + scene root + keyboard/touch listeners + all overlays
  main.tsx             — React root mount
  index.css            — minimal reset (overflow:hidden, background, prefers-reduced-motion)
  game/
    constants.ts       — all tuning values + TIER_COLORS + TIER_LABELS + SpeedTier/GamePhase types
    useGameState.ts    — speed/distance/tier refs + tickGameState()
    useBallPhysics.ts  — x/vx/z refs + keysRef + tickBallPhysics()
    useTileEngine.ts   — 20-tile circular buffer refs + tickTileEngine() + meshRef per tile
    useAudio.ts        — Web Audio hook: hum oscillator, death burst, tier-up chime
  test/
    setup.ts           — vitest + @testing-library/jest-dom bootstrap
```

### Critical Rules

1. **All game logic runs in `useFrame`** — never use `setInterval` or raw `rAF` inside the Canvas.
2. **Use `useRef` for per-frame values** (ball position, speed, tier). `useState` causes React re-render thrashing.
3. **`base: './'` in vite.config.ts** — mandatory for portal iframe embedding. Do not change this.
4. **vitest config uses `vitest/config` import** — not `vite`. Otherwise the `test:` key fails TypeScript checks.
5. **No `enum` keyword** — TypeScript 5.9 has `erasableSyntaxOnly`. Use `const` object + type union (see `GamePhase` and `SpeedTier` in constants.ts).
6. **Track teleportation is imperative** — tile positions are updated via `groupRef.position.z` in `useFrame`, not via React state. This keeps 60fps stable.
7. **Emissive updates only on tier change** — compare `tierColorRef.current` before touching materials to avoid GC pressure from `new THREE.Color()` every frame.

### Speed Tiers

| Tier | Speed Range | Color |
|------|-------------|-------|
| 1 | 0–15 | `#7c3aed` purple |
| 2 | 15–25 | `#06b6d4` cyan |
| 3 | 25–37 | `#ec4899` hot pink |
| 4 | 37+ | `#ffffff` white |

### Physics Tuning (constants.ts)

- `INITIAL_SPEED` = 12 units/sec
- `MAX_SPEED` = 45 units/sec
- `SPEED_INCREMENT` = 0.5 per 20m
- `LATERAL_ACCEL` = 12 units/sec² (key held)
- `LATERAL_DECEL` = 20 units/sec² (key released)
- `MAX_LATERAL_VEL` = ±8 units/sec
- `TRACK_HALF_WIDTH` = 2.5 units (clamps ball)

### Portal Deployment

Games are embedded via iframe at `actuallyfun.games`. The `base: './'` in vite.config.ts is critical — without it, all asset paths break inside the iframe.

### useAudio.ts

Returns `{ startAudio, stopAudio, triggerDeath, triggerTierUp, setTier }`.

- **`startAudio()`** — MUST be called inside a user-gesture handler (e.g. startGame click/keydown). Creates the `AudioContext` and starts a sine-wave hum oscillator at the tier-1 frequency (80Hz), gain 0.08.
- **`stopAudio()`** — Fades the hum out over ~200ms then suspends the context. Called on death.
- **`triggerDeath()`** — Plays a 300ms white-noise burst at gain 0.3 with exponential decay.
- **`triggerTierUp()`** — Plays a two-note chime (C5=523Hz + G5=784Hz) with a 100ms gain envelope.
- **`setTier(tier)`** — Ramps the hum oscillator frequency to the new tier's value (80/120/160/220Hz) with a 100ms time constant.

### Game Phases

Three phases: `IDLE` → `PLAYING` → `DEAD`. Game starts in `IDLE` (shows start screen). Space/tap transitions to `PLAYING`. Death sets `DEAD` (shows game-over overlay). "Play Again" restarts back to `PLAYING` (not `IDLE`).

### Screen Shake

`shakeRef = { active: boolean, elapsed: number }` is passed into `CameraController`. When `active`, each frame: apply `sin/cos` displacement scaled by `0.3*(1 - elapsed/0.3)`, accumulate elapsed, stop after 300ms.

### Tile Fade-in

`TileData.meshRef` is a persistent `MutableRefObject<THREE.Mesh|null>` per tile slot. `tickTileEngine` sets `mat.opacity = 0.5` when recycling a tile. The `Track` component lerps it back to 1 via `delta * 3` each frame. All floor tile materials have `transparent: true`.

## Known Gotchas

- Three.js bundle is ~1MB unminified. The chunk size warning in `npm run build` is expected — not a bug.
- `@react-three/fiber` v9 requires React 19. Both are pinned in package.json.
- The `fogExp2` JSX element needs `attach="fog"` to properly attach to the scene.
- The start screen has its own 100×100 `<Canvas>` instance (separate R3F context) for the preview ball — this is intentional and safe since R3F v9 supports multiple Canvas instances.
- `AudioContext` creation must be deferred to a user-gesture handler to avoid browser autoplay policy rejection. Never create it at module level or in `useEffect` on mount.
