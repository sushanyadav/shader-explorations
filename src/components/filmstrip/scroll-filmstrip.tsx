"use client";

import { Suspense, useRef } from "react";
import { Canvas, useFrame } from "@react-three/fiber";
import { useLenis } from "lenis/react";
import * as THREE from "three";
import { Leva } from "leva";
import { FilmstripScene, type ScrollData } from "./filmstrip-scene";

const IMAGE_COUNT = 5;
// Fix visible world HEIGHT (not width) — keeps halfH constant across all aspect ratios
// With halfH = 5, the dynamic curveAmp formula gives a consistent result on every screen
const TARGET_WORLD_HEIGHT = 10;

function CameraRig() {
  useFrame(({ camera }) => {
    const cam = camera as THREE.PerspectiveCamera;
    const fovRad = (cam.fov * Math.PI) / 180;
    const targetZ = TARGET_WORLD_HEIGHT / (2 * Math.tan(fovRad / 2));
    if (Math.abs(cam.position.z - targetZ) > 0.001) {
      cam.position.z = targetZ;
      cam.updateProjectionMatrix();
    }
  });
  return null;
}

export function ScrollFilmstrip() {
  const scrollRef = useRef<ScrollData>({ progress: 0, velocity: 0 });
  const filmstrip = "interstellar" as const;

  useLenis((lenis) => {
    scrollRef.current.progress = lenis.progress;
    scrollRef.current.velocity = lenis.velocity;
  });

  return (
    <>
      <Leva />
      <div className="fixed inset-0 z-50 pointer-events-none">
        <Canvas
          camera={{ position: [0, 0, 10], fov: 52 }}
          dpr={[1, 2]}
          gl={{ antialias: true }}
          onCreated={({ gl }) => {
            gl.toneMapping = THREE.NoToneMapping;
          }}
        >
          <color attach="background" args={["#f5f5f5"]} />
          <CameraRig />
          <Suspense fallback={null}>
            <FilmstripScene scrollRef={scrollRef} filmstrip={filmstrip} />
          </Suspense>
        </Canvas>
      </div>
      {/* Spacer — gives the scroll wrapper its scrollable height */}
      <div style={{ height: `${IMAGE_COUNT * 100}vh` }} />
    </>
  );
}
