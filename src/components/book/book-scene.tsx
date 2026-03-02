"use client";

import { useRef, useMemo, useEffect } from "react";
import type { MutableRefObject } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import { useTexture } from "@react-three/drei";
import * as THREE from "three";
import { useControls, folder } from "leva";

export type ScrollData = {
  progress: number;
};

type BookSceneProps = {
  scrollRef: MutableRefObject<ScrollData>;
};

const IMAGE_PATHS = [
  "/images/interstellar.webp",
  "/images/image-w1280.webp",
  "/images/interstellar-cooper-murph.webp",
  "/images/interstellar-murph-adult.webp",
  "/images/interstellar-cooper-helmet.webp",
];

const NUM_IMAGES = IMAGE_PATHS.length;
const NUM_FOLDS = NUM_IMAGES - 1;

// Page geometry
const PAGE_WIDTH = 1.28;
const PAGE_HEIGHT = 1.71; // ~4:3 portrait
const PAGE_ASPECT = PAGE_WIDTH / PAGE_HEIGHT;
const NUM_BONES = 256;
const BONE_SEGMENT = PAGE_WIDTH / NUM_BONES;
const Z_SPACING = 0.015;
const FAN_ANGLE_PER_PAGE = 0.012; // radians, fan spread from top-left

const EASING_FACTOR = 10;

// ---------- helpers ----------

function createPageGeometry() {
  const geo = new THREE.PlaneGeometry(PAGE_WIDTH, PAGE_HEIGHT, NUM_BONES, 1);
  // Translate so left edge (spine) is at x=0, right edge at x=PAGE_WIDTH
  geo.translate(PAGE_WIDTH / 2, 0, 0);

  const position = geo.attributes.position;
  const skinIndices: number[] = [];
  const skinWeights: number[] = [];

  for (let i = 0; i < position.count; i++) {
    const x = position.getX(i); // 0 at spine, PAGE_WIDTH at free edge
    const x01 = x / PAGE_WIDTH; // normalize 0..1
    const boneIdx = Math.floor(x01 * NUM_BONES);
    const clamped = Math.min(boneIdx, NUM_BONES - 1);
    const frac = x01 * NUM_BONES - boneIdx;

    skinIndices.push(clamped, Math.min(clamped + 1, NUM_BONES - 1), 0, 0);
    skinWeights.push(1 - frac, frac, 0, 0);
  }

  geo.setAttribute(
    "skinIndex",
    new THREE.Uint16BufferAttribute(skinIndices, 4)
  );
  geo.setAttribute(
    "skinWeight",
    new THREE.Float32BufferAttribute(skinWeights, 4)
  );

  return geo;
}

function createBoneChain(): THREE.Bone[] {
  const bones: THREE.Bone[] = [];
  for (let i = 0; i < NUM_BONES; i++) {
    const bone = new THREE.Bone();
    bone.position.x = i === 0 ? 0 : BONE_SEGMENT;
    if (i > 0) bones[i - 1].add(bone);
    bones.push(bone);
  }
  return bones;
}

function setCoverCrop(texture: THREE.Texture, imageAspect: number) {
  if (PAGE_ASPECT > imageAspect) {
    texture.repeat.set(1, imageAspect / PAGE_ASPECT);
    texture.offset.set(0, (1 - texture.repeat.y) / 2);
  } else {
    texture.repeat.set(PAGE_ASPECT / imageAspect, 1);
    texture.offset.set((1 - texture.repeat.x) / 2, 0);
  }
}

// ---------- Page component ----------

type PageProps = {
  texture: THREE.Texture;
  pageIndex: number;
  numImages: number;
  foldProgressRef: MutableRefObject<number[]>;
  config: {
    rollAngle: number;
    roughness: number;
  };
};

function Page({
  texture,
  pageIndex,
  numImages,
  foldProgressRef,
  config,
}: PageProps) {
  const groupRef = useRef<THREE.Group>(null);
  const fanRef = useRef<THREE.Group>(null);

  const { mesh, bones } = useMemo(() => {
    const geo = createPageGeometry();
    const boneChain = createBoneChain();
    const skeleton = new THREE.Skeleton(boneChain);

    const mat = new THREE.MeshStandardMaterial({
      map: texture,
      side: THREE.DoubleSide,
      roughness: 0.25,
      metalness: 0.0,
      polygonOffset: true,
      polygonOffsetFactor: 1,
      polygonOffsetUnits: 1,
    });

    // Curvature-based roughness: flat=matte, fold=shiny + darken backface
    mat.onBeforeCompile = (shader) => {
      shader.fragmentShader = shader.fragmentShader.replace(
        "#include <map_fragment>",
        `#include <map_fragment>
        if (!gl_FrontFacing) {
          diffuseColor.rgb *= 0.35;
        }`
      );
      shader.fragmentShader = shader.fragmentShader.replace(
        "#include <roughnessmap_fragment>",
        `#include <roughnessmap_fragment>
        float curvature = length(fwidth(vNormal));
        float foldFactor = smoothstep(0.0, 0.12, curvature);
        roughnessFactor = mix(roughnessFactor, 0.05, foldFactor);`
      );
    };

    const sm = new THREE.SkinnedMesh(geo, mat);
    sm.castShadow = true;
    sm.receiveShadow = true;
    sm.frustumCulled = false;
    sm.add(boneChain[0]);
    sm.bind(skeleton);

    return { mesh: sm, bones: boneChain };
  }, [texture]);

  // Cleanup
  useEffect(() => {
    return () => {
      mesh.geometry.dispose();
      if (mesh.material instanceof THREE.Material) mesh.material.dispose();
      mesh.skeleton.dispose();
    };
  }, [mesh]);

  useFrame((_, delta) => {
    const foldProgress = foldProgressRef.current[pageIndex];

    // Uniform roll: each bone rotates by the same amount → clean cylinder
    const totalAngle = -foldProgress * config.rollAngle;
    const perBone = totalAngle / (bones.length - 1); // bone 0 is anchor

    for (let i = 0; i < bones.length; i++) {
      const boneTarget = i === 0 ? 0 : perBone;
      // eslint-disable-next-line react-hooks/immutability -- Three.js bone rotation is imperative
      bones[i].rotation.y = THREE.MathUtils.damp(
        bones[i].rotation.y,
        boneTarget,
        EASING_FACTOR,
        delta
      );
    }

    // Update material roughness from Leva
    if (mesh.material instanceof THREE.MeshStandardMaterial) {
      // eslint-disable-next-line react-hooks/immutability -- Three.js material property is imperative
      mesh.material.roughness = config.roughness;
    }

    // Z-ordering: small boost just enough to clear the flat page stack
    // (previous boost of PAGE_WIDTH*0.4 was too large, causing crease detach)
    if (groupRef.current) {
      const flatZ = (numImages - 1 - pageIndex) * Z_SPACING;
      const foldedZ = pageIndex * Z_SPACING;
      const baseZ = flatZ + (foldedZ - flatZ) * foldProgress;
      const activeBoost =
        Math.sin(foldProgress * Math.PI) * Z_SPACING * numImages;
      groupRef.current.position.z = baseZ + activeBoost;
    }

    // Fan spread from top-left corner, collapses as page folds
    if (fanRef.current) {
      const fanTarget = pageIndex * FAN_ANGLE_PER_PAGE * (1 - foldProgress);
      fanRef.current.rotation.z = THREE.MathUtils.damp(
        fanRef.current.rotation.z,
        fanTarget,
        EASING_FACTOR,
        delta
      );
    }
  });

  return (
    <group ref={groupRef}>
      {/* Pivot at top-left corner, fan shows edges at top-right */}
      <group position={[0, PAGE_HEIGHT / 2, 0]}>
        <group ref={fanRef}>
          <group position={[0, -PAGE_HEIGHT / 2, 0]}>
            <primitive object={mesh} />
          </group>
        </group>
      </group>
    </group>
  );
}

// ---------- Scene ----------

export function BookScene({ scrollRef }: BookSceneProps) {
  const textures = useTexture(IMAGE_PATHS, (loaded) => {
    const arr = Array.isArray(loaded) ? loaded : [loaded];
    for (const tex of arr) {
      tex.colorSpace = THREE.SRGBColorSpace;
      tex.wrapS = THREE.ClampToEdgeWrapping;
      tex.wrapT = THREE.ClampToEdgeWrapping;
      const img = tex.image as HTMLImageElement;
      setCoverCrop(tex, img.width / img.height);
    }
  });
  const { viewport } = useThree();

  const config = useControls({
    fold: folder({
      meshScale: { value: 0.65, min: 0.3, max: 1.0, step: 0.05 },
      rollAngle: {
        value: 7.6,
        min: Math.PI,
        max: 8 * Math.PI,
        step: 0.1,
        label: "Roll Angle",
      },
      roughness: {
        value: 0.25,
        min: 0,
        max: 1,
        step: 0.05,
        label: "Roughness",
      },
    }),
  });

  const foldProgressRef = useRef<number[]>(new Array(NUM_IMAGES).fill(0));
  const bookRef = useRef<THREE.Group>(null);

  useFrame((_, delta) => {
    const progress = scrollRef.current.progress;
    for (let i = 0; i < NUM_IMAGES; i++) {
      foldProgressRef.current[i] = Math.min(
        Math.max(progress * NUM_FOLDS - i, 0),
        1
      );
    }

    // Animate tilt in on load
    if (bookRef.current) {
      bookRef.current.rotation.x = THREE.MathUtils.damp(
        bookRef.current.rotation.x,
        0.08,
        3,
        delta
      );
    }
  });

  const scaleFactor = (viewport.height * config.meshScale) / PAGE_HEIGHT;

  return (
    <group ref={bookRef} scale={[scaleFactor, scaleFactor, scaleFactor]}>
      {textures.map((tex, i) => (
        <Page
          key={i}
          texture={tex}
          pageIndex={i}
          numImages={NUM_IMAGES}
          foldProgressRef={foldProgressRef}
          config={config}
        />
      ))}
    </group>
  );
}
