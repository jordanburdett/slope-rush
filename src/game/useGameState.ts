import { useCallback, useRef } from 'react'
import {
  INITIAL_SPEED,
  MAX_SPEED,
  SPEED_INCREMENT,
  SPEED_INTERVAL,
  getSpeedTier,
  type SpeedTier,
  type GamePhase,
  GamePhase as GamePhaseConst,
} from './constants'

export interface GameStateRefs {
  speedRef: React.MutableRefObject<number>
  distanceRef: React.MutableRefObject<number>
  tierRef: React.MutableRefObject<SpeedTier>
  phaseRef: React.MutableRefObject<GamePhase>
  lastSpeedUpDistRef: React.MutableRefObject<number>
  resetState: (speed: number) => void
  setPhase: (phase: GamePhase) => void
}

export function useGameState(): GameStateRefs {
  const speedRef = useRef<number>(INITIAL_SPEED)
  const distanceRef = useRef<number>(0)
  const tierRef = useRef<SpeedTier>(getSpeedTier(INITIAL_SPEED))
  const phaseRef = useRef<GamePhase>(GamePhaseConst.PLAYING)
  const lastSpeedUpDistRef = useRef<number>(0)

  const resetState = useCallback((speed: number) => {
    speedRef.current = speed
    distanceRef.current = 0
    tierRef.current = getSpeedTier(speed)
    lastSpeedUpDistRef.current = 0
  }, [])

  const setPhase = useCallback((phase: GamePhase) => {
    phaseRef.current = phase
  }, [])

  return { speedRef, distanceRef, tierRef, phaseRef, lastSpeedUpDistRef, resetState, setPhase }
}

/**
 * Called each frame to update speed, distance, tier.
 * Returns true if tier changed (so caller can update materials).
 */
export function tickGameState(
  refs: GameStateRefs,
  delta: number,
): boolean {
  const { speedRef, distanceRef, tierRef, lastSpeedUpDistRef } = refs

  const speed = speedRef.current
  const dist = distanceRef.current

  // Accumulate distance
  const newDist = dist + speed * delta
  distanceRef.current = newDist

  // Escalate speed every SPEED_INTERVAL meters
  let newSpeed = speed
  if (newDist - lastSpeedUpDistRef.current >= SPEED_INTERVAL) {
    newSpeed = Math.min(speed + SPEED_INCREMENT, MAX_SPEED)
    speedRef.current = newSpeed
    lastSpeedUpDistRef.current = newDist
  }

  // Check tier change
  const newTier = getSpeedTier(newSpeed)
  if (newTier !== tierRef.current) {
    tierRef.current = newTier
    return true
  }

  return false
}
