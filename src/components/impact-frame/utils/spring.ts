/**
 * Damped harmonic oscillator — semi-implicit Euler integration.
 *
 * Used for the revert phase: snaps progress back to 0 with
 * overshoot and settle, giving that satisfying "spring" feel.
 *
 * Default config: stiffness=180, damping=12 → fast snap,
 * slight overshoot below 0, settles in ~300ms.
 */

export type SpringState = {
  value: number;
  velocity: number;
};

export type SpringConfig = {
  stiffness: number;
  damping: number;
  mass: number;
};

export const DEFAULT_SPRING: SpringConfig = {
  stiffness: 180,
  damping: 12,
  mass: 1,
};

/**
 * Advance the spring one time step.
 * Target is always 0 (we're springing back to idle).
 *
 * Returns true when settled (value ≈ 0 and velocity ≈ 0).
 */
export function stepSpring(
  state: SpringState,
  config: SpringConfig,
  dt: number
): boolean {
  const { stiffness, damping, mass } = config;

  // Force = -k*x - c*v
  const force = -stiffness * state.value - damping * state.velocity;
  const acceleration = force / mass;

  // Semi-implicit Euler: update velocity first, then position
  state.velocity += acceleration * dt;
  state.value += state.velocity * dt;

  // Clamp small overshoot below 0
  if (state.value < -0.02) {
    state.value = -0.02;
  }

  // Check if settled
  const settled =
    Math.abs(state.value) < 0.001 && Math.abs(state.velocity) < 0.01;

  if (settled) {
    state.value = 0;
    state.velocity = 0;
  }

  return settled;
}
