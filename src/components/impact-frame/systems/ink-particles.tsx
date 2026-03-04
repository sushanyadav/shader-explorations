"use client";

import { useRef, useMemo } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";

const PARTICLE_COUNT = 200;
const LIFETIME = 1.5; // seconds
const GRAVITY = -3.0;
const DRAG = 0.96;

type ParticleState = {
  alive: boolean;
  age: number;
  px: number;
  py: number;
  vx: number;
  vy: number;
  size: number;
  opacity: number;
};

const inkVert = /* glsl */ `
  attribute float aSize;
  attribute float aOpacity;
  varying float vOpacity;

  void main() {
    vOpacity = aOpacity;
    vec4 mvPos = modelViewMatrix * vec4(position, 1.0);
    gl_PointSize = aSize * (300.0 / -mvPos.z);
    gl_Position = projectionMatrix * mvPos;
  }
`;

const inkFrag = /* glsl */ `
  precision highp float;
  varying float vOpacity;

  void main() {
    // Soft circle with noise-deformed edge for ink splatter look
    vec2 uv = gl_PointCoord - 0.5;
    float dist = length(uv);

    // Noise deformation on the edge
    float angle = atan(uv.y, uv.x);
    float noise = sin(angle * 5.0) * 0.08 + sin(angle * 11.0) * 0.04;
    float radius = 0.35 + noise;

    float alpha = 1.0 - smoothstep(radius - 0.08, radius, dist);
    alpha *= vOpacity;

    if (alpha < 0.01) discard;
    gl_FragColor = vec4(vec3(0.0), alpha);
  }
`;

type InkParticlesProps = {
  peakTriggered: boolean;
  origin: [number, number];
  phase: string;
  viewportWidth: number;
  viewportHeight: number;
};

export function InkParticles({
  peakTriggered,
  origin,
  phase,
  viewportWidth,
  viewportHeight,
}: InkParticlesProps) {
  const pointsRef = useRef<THREE.Points>(null);
  const peakFiredRef = useRef(false);

  const particles = useRef<ParticleState[]>(
    Array.from({ length: PARTICLE_COUNT }, () => ({
      alive: false,
      age: 0,
      px: 0,
      py: 0,
      vx: 0,
      vy: 0,
      size: 0,
      opacity: 0,
    }))
  );

  const { positions, sizes, opacities, geometry } = useMemo(() => {
    const pos = new Float32Array(PARTICLE_COUNT * 3);
    const sz = new Float32Array(PARTICLE_COUNT);
    const op = new Float32Array(PARTICLE_COUNT);

    const geom = new THREE.BufferGeometry();
    geom.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    geom.setAttribute("aSize", new THREE.BufferAttribute(sz, 1));
    geom.setAttribute("aOpacity", new THREE.BufferAttribute(op, 1));

    return { positions: pos, sizes: sz, opacities: op, geometry: geom };
  }, []);

  useFrame((_, delta) => {
    const dt = Math.min(delta, 0.1);

    // Fire particles on peak
    if (peakTriggered && !peakFiredRef.current) {
      peakFiredRef.current = true;

      // Convert UV origin (0..1) to world coords
      const wx = (origin[0] - 0.5) * viewportWidth;
      const wy = (origin[1] - 0.5) * viewportHeight;

      for (let i = 0; i < PARTICLE_COUNT; i++) {
        const p = particles.current[i];
        p.alive = true;
        p.age = 0;
        p.px = wx;
        p.py = wy;

        // Radial burst — bigger, more dramatic
        const angle = Math.random() * Math.PI * 2;
        const speed = 2.0 + Math.random() * 6.0;
        p.vx = Math.cos(angle) * speed;
        p.vy = Math.sin(angle) * speed;
        p.size = 0.3 + Math.random() * 0.8;
        p.opacity = 0.85 + Math.random() * 0.15;
      }
    }

    // Reset when no longer at peak
    if (phase !== "peak" && phase !== "reverting") {
      peakFiredRef.current = false;
    }

    // Update particles
    let anyAlive = false;
    for (let i = 0; i < PARTICLE_COUNT; i++) {
      const p = particles.current[i];
      if (!p.alive) {
        positions[i * 3 + 1] = -999; // offscreen
        opacities[i] = 0;
        continue;
      }

      p.age += dt;
      if (p.age > LIFETIME) {
        p.alive = false;
        positions[i * 3 + 1] = -999;
        opacities[i] = 0;
        continue;
      }

      anyAlive = true;

      // Physics
      p.vy += GRAVITY * dt;
      p.vx *= DRAG;
      p.vy *= DRAG;
      p.px += p.vx * dt;
      p.py += p.vy * dt;

      // Fade out
      const life = p.age / LIFETIME;
      const fade = 1.0 - life * life; // quadratic fade

      positions[i * 3] = p.px;
      positions[i * 3 + 1] = p.py;
      positions[i * 3 + 2] = 0;
      sizes[i] = p.size * (1.0 + life * 0.5); // grow slightly
      opacities[i] = p.opacity * fade;
    }

    // Update buffers
    if (anyAlive || peakTriggered) {
      geometry.attributes.position.needsUpdate = true;
      (geometry.attributes.aSize as THREE.BufferAttribute).needsUpdate = true;
      (geometry.attributes.aOpacity as THREE.BufferAttribute).needsUpdate = true;
    }
  });

  return (
    <points ref={pointsRef} geometry={geometry} frustumCulled={false}>
      <shaderMaterial
        vertexShader={inkVert}
        fragmentShader={inkFrag}
        transparent
        depthTest={false}
        depthWrite={false}
        blending={THREE.NormalBlending}
      />
    </points>
  );
}
