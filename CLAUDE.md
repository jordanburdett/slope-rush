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
  App.tsx              — Canvas + scene root + keyboard listeners + HUD
  main.tsx             — React root mount
  index.css            — minimal reset (overflow:hidden, background)
  game/
    constants.ts       — all tuning values + TIER_COLORS + SpeedTier type
    useGameState.ts    — speed/distance/tier refs + tickGameState()
    useBallPhysics.ts  — x/vx/z refs + keysRef + tickBallPhysics()
    useTileEngine.ts   — 20-tile circular buffer refs + tickTileEngine()
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

## Known Gotchas

- Three.js bundle is ~1MB unminified. The chunk size warning in `npm run build` is expected — not a bug.
- `@react-three/fiber` v9 requires React 19. Both are pinned in package.json.
- The `fogExp2` JSX element needs `attach="fog"` to properly attach to the scene.
