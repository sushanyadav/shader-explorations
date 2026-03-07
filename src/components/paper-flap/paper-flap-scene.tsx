"use client";

import { useRef, useMemo, useEffect } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import { useTexture } from "@react-three/drei";
import * as THREE from "three";
import { useControls, folder } from "leva";

const SEGMENTS_Y = 16;
const IMAGE_PATH = "/images/model.webp";

/* ─── Shaders ─── */

const stripVertexShader = /* glsl */ `
  uniform float uFoldAngle;
  uniform float uStripH;
  varying vec2 vUv;
  varying float vDistFromHinge;

  void main() {
    vUv = uv;
    vec3 pos = position;

    float distFromHinge = (uStripH * 0.5) - pos.y;
    vDistFromHinge = distFromHinge / uStripH;

    pos.y = (uStripH * 0.5) - distFromHinge * cos(uFoldAngle);
    pos.z = distFromHinge * sin(uFoldAngle);

    gl_Position = projectionMatrix * modelViewMatrix * vec4(pos, 1.0);
  }
`;

const stripFragmentShader = /* glsl */ `
  uniform sampler2D uTexture;
  uniform float uUvLeft;
  uniform float uUvRight;
  uniform float uUvTop;
  uniform float uUvBottom;
  varying vec2 vUv;

  void main() {
    vec2 texUv = vec2(
      mix(uUvLeft, uUvRight, vUv.x),
      mix(uUvBottom, uUvTop, vUv.y)
    );
    vec4 color = texture2D(uTexture, texUv);

    // Back face only
    if (!gl_FrontFacing) {
      color.rgb *= 0.3;
    }

    gl_FragColor = color;
    #include <colorspace_fragment>
  }
`;

const shadowVertexShader = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const shadowFragmentShader = /* glsl */ `
  uniform float uOpacity;
  varying vec2 vUv;

  void main() {
    float falloff = 1.0 - vUv.y;
    falloff = pow(falloff, 1.5);
    gl_FragColor = vec4(0.0, 0.0, 0.0, uOpacity * falloff);
  }
`;

/* ─── Types ─── */

type StripState = {
  angle: number;
  velocity: number;
};

/* ─── Helpers ─── */

function smoothstep(edge0: number, edge1: number, x: number) {
  const t = Math.max(0, Math.min(1, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

/* ─── Scene ─── */

export function PaperFlapScene() {
  const { viewport, size } = useThree();
  const texture = useTexture(IMAGE_PATH);

  // Structural controls (changing these rebuilds geometry + uniforms)
  const layout = useControls("layout", {
    stripCount: { value: 12, min: 2, max: 20, step: 1 },
    coverage: { value: 0.7, min: 0.1, max: 1.0, step: 0.05, label: "coverage %" },
  });

  const config = useControls({
    wind: folder({
      maxFoldAngle: { value: 1.2, min: 0.1, max: Math.PI * 0.8, step: 0.01 },
      windStrength: { value: 3.0, min: 0.1, max: 8.0, step: 0.05 },
      influenceRadius: { value: 0.35, min: 0.05, max: 1.0, step: 0.01 },
    }),
    spring: folder({
      stiffness: { value: 13.5, min: 1.0, max: 30.0, step: 0.5 },
      damping: { value: 5.5, min: 0.5, max: 10.0, step: 0.1 },
    }),
    shadow: folder({
      shadowOpacity: { value: 0.23, min: 0.0, max: 1.0, step: 0.01 },
      shadowScale: { value: 0.47, min: 0.05, max: 1.0, step: 0.01 },
    }),
  });

  const configRef = useRef(config);
  configRef.current = config;

  useMemo(() => {
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.minFilter = THREE.LinearFilter;
    texture.magFilter = THREE.LinearFilter;
  }, [texture]);

  // Cover-fit dimensions — rebuilds when layout changes
  const dims = useMemo(() => {
    const img = texture.image as HTMLImageElement;
    const imageAspect = img.width / img.height;
    const viewAspect = viewport.width / viewport.height;

    let w: number;
    let h: number;
    if (viewAspect > imageAspect) {
      w = viewport.width;
      h = viewport.width / imageAspect;
    } else {
      h = viewport.height;
      w = viewport.height * imageAspect;
    }

    const count = layout.stripCount;
    const stripW = w / count;
    const stripH = h * layout.coverage;

    return { planeW: w, planeH: h, stripW, stripH, count };
  }, [texture, viewport.width, viewport.height, layout.stripCount, layout.coverage]);

  const mouse = useRef({ worldX: 0, prevWorldX: 0, speed: 0 });

  // Reset strip states when count changes
  const strips = useRef<StripState[]>([]);
  if (strips.current.length !== dims.count) {
    strips.current = Array.from({ length: dims.count }, () => ({
      angle: 0,
      velocity: 0,
    }));
  }

  // Stable uniform objects — recreated only when layout changes
  const stripUniforms = useMemo(() => {
    const { planeW, stripW, stripH, count } = dims;
    return Array.from({ length: count }, (_, i) => ({
      uTexture: { value: texture },
      uFoldAngle: { value: 0 },
      uStripH: { value: stripH },
      uUvLeft: { value: (stripW * i) / planeW },
      uUvRight: { value: (stripW * (i + 1)) / planeW },
      uUvTop: { value: layout.coverage },
      uUvBottom: { value: 0 },
    }));
  }, [texture, dims, layout.coverage]);

  const shadowUniforms = useMemo(() => {
    return Array.from({ length: dims.count }, () => ({
      uOpacity: { value: 0 },
    }));
  }, [dims.count]);

  const shadowMeshRefs = useRef<(THREE.Mesh | null)[]>([]);

  useEffect(() => {
    const handleMove = (e: PointerEvent) => {
      const ndcX = (e.clientX / size.width) * 2 - 1;
      mouse.current.worldX = ndcX * (viewport.width / 2);
    };
    window.addEventListener("pointermove", handleMove);
    return () => window.removeEventListener("pointermove", handleMove);
  }, [size.width, viewport.width]);

  useFrame((_, delta) => {
    const dt = Math.min(delta, 0.05);
    const cfg = configRef.current;
    const { planeW, stripW, stripH, count } = dims;
    const halfW = planeW / 2;

    const vx =
      (mouse.current.worldX - mouse.current.prevWorldX) / Math.max(dt, 0.001);
    mouse.current.speed = Math.abs(vx);
    mouse.current.prevWorldX = mouse.current.worldX;

    for (let i = 0; i < count; i++) {
      const state = strips.current[i];
      if (!state) continue;

      const stripCenterX = -halfW + stripW * i + stripW / 2;
      const dist = Math.abs(mouse.current.worldX - stripCenterX);
      const normalizedDist = dist / (planeW * cfg.influenceRadius);
      const proximity = smoothstep(1.0, 0.0, normalizedDist);

      const windFactor = mouse.current.speed * cfg.windStrength;
      const targetAngle = Math.min(
        proximity * windFactor * 0.08,
        cfg.maxFoldAngle
      );

      const force = (targetAngle - state.angle) * cfg.stiffness;
      state.velocity += force * dt;
      state.velocity *= Math.max(0, 1 - cfg.damping * dt);
      state.angle += state.velocity * dt;
      state.angle = Math.max(0, Math.min(state.angle, cfg.maxFoldAngle));

      const su = stripUniforms[i];
      if (su) {
        su.uFoldAngle.value = state.angle;
      }

      const shu = shadowUniforms[i];
      const shadowMesh = shadowMeshRefs.current[i];
      if (shu && shadowMesh) {
        const foldRatio = state.angle / cfg.maxFoldAngle;
        shu.uOpacity.value = foldRatio * cfg.shadowOpacity;

        const shadowH = stripH * cfg.shadowScale * foldRatio;
        shadowMesh.scale.y = Math.max(0.001, shadowH / stripH);

        const regionCenterY = -dims.planeH / 2 + stripH / 2;
        const localFoldedBottom =
          stripH / 2 - stripH * Math.cos(state.angle);
        shadowMesh.position.y =
          regionCenterY + localFoldedBottom - shadowH / 2;
      }
    }
  });

  // Strip positions — bottom-aligned
  const stripPositions = useMemo(() => {
    const { planeW, planeH, stripW, stripH, count } = dims;
    const halfW = planeW / 2;
    const regionCenterY = -planeH / 2 + stripH / 2;
    return Array.from({ length: count }, (_, i) => ({
      centerX: -halfW + stripW * i + stripW / 2,
      centerY: regionCenterY,
      index: i,
    }));
  }, [dims]);

  const regionY = -dims.planeH / 2 + dims.stripH / 2;

  // Force full remount of strips when layout changes
  const layoutKey = `${dims.count}-${layout.coverage}`;

  return (
    <group>
      {/* Base image */}
      <mesh position={[0, 0, 0]}>
        <planeGeometry args={[dims.planeW, dims.planeH]} />
        <meshBasicMaterial map={texture} toneMapped={false} />
      </mesh>

      {/* All strip-related meshes — remount on layout change */}
      <group key={layoutKey}>
        {/* Vertical cut lines */}
        {Array.from({ length: dims.count + 1 }, (_, i) => {
          const x = -dims.planeW / 2 + dims.stripW * i;
          return (
            <mesh key={`cut-${i}`} position={[x, regionY, 0.0004]}>
              <planeGeometry args={[0.004, dims.stripH]} />
              <meshBasicMaterial
                color={0x000000}
                transparent
                opacity={0.35}
                depthWrite={false}
              />
            </mesh>
          );
        })}


        {/* Shadow planes */}
        {stripPositions.map((strip) => (
          <mesh
            key={`shadow-${strip.index}`}
            position={[strip.centerX, strip.centerY, 0.0003]}
            ref={(el) => {
              shadowMeshRefs.current[strip.index] = el;
            }}
          >
            <planeGeometry args={[dims.stripW, dims.stripH]} />
            <shaderMaterial
              vertexShader={shadowVertexShader}
              fragmentShader={shadowFragmentShader}
              transparent
              depthWrite={false}
              uniforms={shadowUniforms[strip.index]}
            />
          </mesh>
        ))}

        {/* Strip meshes */}
        {stripPositions.map((strip) => (
          <mesh
            key={`strip-${strip.index}`}
            position={[strip.centerX, strip.centerY, 0.001]}
          >
            <planeGeometry args={[dims.stripW, dims.stripH, 1, SEGMENTS_Y]} />
            <shaderMaterial
              vertexShader={stripVertexShader}
              fragmentShader={stripFragmentShader}
              side={THREE.DoubleSide}
              uniforms={stripUniforms[strip.index]}
              toneMapped={false}
            />
          </mesh>
        ))}
      </group>
    </group>
  );
}
