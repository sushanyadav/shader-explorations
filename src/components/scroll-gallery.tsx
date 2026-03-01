"use client";

import { Suspense, useRef, useEffect, useState } from "react";
import { Canvas, useThree } from "@react-three/fiber";
import { useLenis } from "lenis/react";
import * as THREE from "three";
import { Leva } from "leva";
import {
  GalleryScene,
  type ScrollData,
  type GalleryKey,
} from "./gallery-scene";

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
  const [gallery, setGallery] = useState<GalleryKey>("interstellar");

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
            <GalleryScene scrollRef={scrollRef} gallery={gallery} />
          </Suspense>
        </Canvas>
      </div>
      {/* Gallery toggle */}
      {/* <div className="fixed bottom-8 left-1/2 -translate-x-1/2 z-50 pointer-events-auto">
        <div className="flex rounded-full bg-black/8 backdrop-blur-sm border border-black/10 p-1 gap-0.5">
          {(["interstellar", "fightclub"] as const).map((key) => (
            <button
              key={key}
              onClick={() => setGallery(key)}
              className={`rounded-full px-4 py-1.5 text-xs font-medium transition-all ${
                gallery === key
                  ? "bg-black text-white"
                  : "text-black/40 hover:text-black/70"
              }`}
            >
              {key === "interstellar" ? "Interstellar" : "Fight Club"}
            </button>
          ))}
        </div>
      </div> */}
      {/* Spacer — gives the scroll wrapper its scrollable height */}
      <div style={{ height: `${IMAGE_COUNT * 100}vh` }} />
    </>
  );
}
