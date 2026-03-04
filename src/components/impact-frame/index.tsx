"use client";

import { Suspense, useState } from "react";
import { Canvas } from "@react-three/fiber";
import * as THREE from "three";
import { Leva } from "leva";

import { ImpactScene } from "./impact-scene";
import { Onomatopoeia } from "./systems/onomatopoeia";

function Loader() {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black transition-opacity duration-500">
      <div className="flex flex-col items-center gap-4">
        <div className="size-8 animate-spin rounded-full border-2 border-white/20 border-t-white" />
        <p className="text-sm text-white/50">Loading</p>
      </div>
    </div>
  );
}

export function ImpactExperience() {
  const [ready, setReady] = useState(false);

  return (
    <>
      <Leva />
      {!ready && <Loader />}
      <div className="fixed inset-0">
        <Canvas
          camera={{ position: [0, 0, 5], fov: 50 }}
          dpr={[1, 2]}
          gl={{ antialias: true }}
          onCreated={({ gl }) => {
            gl.toneMapping = THREE.NoToneMapping;
            gl.setClearColor(0x000000, 1);
          }}
        >
          <Suspense fallback={null}>
            <ImpactScene onReady={() => setReady(true)} />
          </Suspense>
        </Canvas>
      </div>
      <Onomatopoeia />
    </>
  );
}
