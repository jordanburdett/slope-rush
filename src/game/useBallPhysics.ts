import { useRef } from 'react'
import {
  LATERAL_ACCEL,
  LATERAL_DECEL,
  MAX_LATERAL_VEL,
  TRACK_HALF_WIDTH,
} from './constants'

export interface BallRefs {
  xRef: React.MutableRefObject<number>
  vxRef: React.MutableRefObject<number>
  zRef: React.MutableRefObject<number>
}

export interface KeysRef {
  left: boolean
  right: boolean
}

export function useBallPhysics(): { ball: BallRefs; keysRef: React.MutableRefObject<KeysRef> } {
  const xRef = useRef<number>(0)
  const vxRef = useRef<number>(0)
  const zRef = useRef<number>(0)

  const keysRef = useRef<KeysRef>({ left: false, right: false })

  return {
    ball: { xRef, vxRef, zRef },
    keysRef,
  }
}

/**
 * Advance lateral ball physics by one frame.
 * Returns new x position.
 */
export function tickBallPhysics(
  ball: BallRefs,
  keysRef: React.MutableRefObject<KeysRef>,
  forwardSpeed: number,
  delta: number,
): number {
  const { xRef, vxRef, zRef } = ball
  const { left, right } = keysRef.current

  let vx = vxRef.current

  if (left && !right) {
    vx -= LATERAL_ACCEL * delta
  } else if (right && !left) {
    vx += LATERAL_ACCEL * delta
  } else {
    // Decelerate toward zero
    if (Math.abs(vx) < LATERAL_DECEL * delta) {
      vx = 0
    } else {
      vx -= Math.sign(vx) * LATERAL_DECEL * delta
    }
  }

  // Clamp lateral velocity
  vx = Math.max(-MAX_LATERAL_VEL, Math.min(MAX_LATERAL_VEL, vx))
  vxRef.current = vx

  // Update positions
  let newX = xRef.current + vx * delta
  // Clamp to track bounds
  newX = Math.max(-TRACK_HALF_WIDTH, Math.min(TRACK_HALF_WIDTH, newX))
  // If clamped, kill lateral velocity
  if (newX === -TRACK_HALF_WIDTH || newX === TRACK_HALF_WIDTH) {
    vxRef.current = 0
  }
  xRef.current = newX

  // Move forward
  zRef.current -= forwardSpeed * delta

  return newX
}
