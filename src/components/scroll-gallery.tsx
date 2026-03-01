"use client";

import { Suspense, useRef, useEffect } from "react";
import { Canvas, useThree } from "@react-three/fiber";
import { useLenis } from "lenis/react";
import * as THREE from "three";
import { GalleryScene, type ScrollData } from "./gallery-scene";

const IMAGE_COUNT = 5;
// Fix visible world HEIGHT (not width) — keeps halfH constant across all aspect ratios
// With halfH = 5, the dynamic curveAmp formula gives a consistent result on every screen
const TARGET_WORLD_HEIGHT = 10;

function CameraRig() {
  const { camera, size } = useThree();
  useEffect(() => {
    const cam = camera as THREE.PerspectiveCamera;
    const fovRad = (cam.fov * Math.PI) / 180;
    // No aspect factor — fixes HEIGHT, width scales with screen aspect ratio
    cam.position.z = TARGET_WORLD_HEIGHT / (2 * Math.tan(fovRad / 2));
    cam.updateProjectionMatrix();
  }, [camera, size]);
  return null;
}

export function ScrollGallery() {
  const scrollRef = useRef<ScrollData>({ progress: 0, velocity: 0 });

  useLenis((lenis) => {
    scrollRef.current.progress = lenis.progress;
    scrollRef.current.velocity = lenis.velocity;
  });

  return (
    <>
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
            <GalleryScene scrollRef={scrollRef} />
          </Suspense>
        </Canvas>
      </div>
      {/* Spacer — gives the scroll wrapper its scrollable height */}
      <div style={{ height: `${IMAGE_COUNT * 100}vh` }} />
    </>
  );
}
