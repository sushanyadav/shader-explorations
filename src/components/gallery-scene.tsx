import { useFrame, useThree } from "@react-three/fiber";
import { useTexture } from "@react-three/drei";
import { useRef, useMemo } from "react";
import type { MutableRefObject } from "react";
import * as THREE from "three";
import { useControls, folder } from "leva";

export const GALLERIES = {
  interstellar: [
    "/images/interstellar.webp",
    "/images/image-w1280.webp",
    "/images/interstellar-cooper-murph.webp",
    "/images/interstellar-murph-adult.webp",
    "/images/interstellar-cooper-helmet.webp",
  ],
  fightclub: [
    "/images/fight-club.webp",
    "/images/fight-club-tyler.webp",
    "/images/fight-club-marla.webp",
    "/images/fight-club-soap.webp",
    "/images/fight-club-rules.webp",
  ],
} as const;

export type GalleryKey = keyof typeof GALLERIES;

const IMAGE_COUNT = 5;

export type ScrollData = {
  progress: number;
  velocity: number;
};

const vertexShader = /* glsl */ `
  uniform float uAngle;
  uniform float uAmp;
  uniform float uFreq;
  uniform float uZDepth;
  uniform float uStripH;
  uniform float uTwist;
  uniform float uFlatZone;

  varying float vS;
  varying float vV;
  varying vec3 vNormal;

  void main() {
    float s = position.x;
    float cross = position.y;

    float ca = cos(uAngle);
    float sa = sin(uAngle);

    float px = s * ca;
    float py = s * sa;
    float pz = uZDepth * exp(-s * s * 0.020);

    // Tangent is horizontal (flat path)
    float tx = ca;
    float ty = sa;

    // Cross-section normal (perpendicular to tangent in XY)
    float nx = -ty;
    float ny =  tx;

    // Use tanh (sigmoid) instead of sin so the twist MONOTONICALLY increases
    // from center outward — no peak/reversal, guaranteed perfect left/right symmetry.
    // tanh(-s) = -tanh(s) ensures both ends bend by identical amounts.
    float tsig = tanh(s * uFreq);          // monotonic: -1 (far left) → 0 (center) → +1 (far right)
    float t01  = smoothstep(uFlatZone, 1.0, abs(tsig));
    // Left (s<0): tsig<0 → effective>0 → rollY>0 → sweeps UP
    // Right (s>0): tsig>0 → effective<0 → rollY<0 → sweeps DOWN
    float effective  = -sign(tsig) * t01;
    float twistAngle = uTwist * effective;
    float ct = cos(twistAngle);
    float st = sin(twistAngle);

    // Twisted cross-section vectors
    // st sign kept: left end (st>0) tilts top toward camera, right end (st<0) tilts top AWAY
    // This gives the right end the "face-down" look seen in the reference
    float tnx = nx * ct;
    float tny = ny * ct;
    float tnz = st;

    // Roll arc: path center rises/falls as ribbon twists.
    // rollZ = 0 keeps both ends at same Z depth (no perspective size asymmetry)
    float rollY = sign(effective) * uAmp * (1.0 - ct);
    float rollZ = 0.0;

    // World position: flat path + roll arc + twisted cross-section
    vec3 wp;
    wp.x = px + cross * tnx;
    wp.y = py + rollY + cross * tny;
    wp.z = pz + rollZ + cross * tnz;

    vS = s;
    vV = cross / uStripH + 0.5;

    // Surface normal — derived from tangent × cross-section direction
    vNormal = vec3(ty * st, -tx * st, ct);

    gl_Position = projectionMatrix * viewMatrix * vec4(wp, 1.0);
  }
`;

const fragmentShader = /* glsl */ `
  uniform sampler2D uTex0;
  uniform sampler2D uTex1;
  uniform sampler2D uTex2;
  uniform sampler2D uTex3;
  uniform sampler2D uTex4;
  uniform float uScroll;
  uniform float uSegW;
  uniform float uCount;
  uniform float uSegAspect;
  uniform float uAspects[5];
  uniform vec3 uLightDir;
  uniform float uLightMin;
  uniform float uLightMax;
  uniform float uEdgeVignette;
  uniform vec3 uBackColor;
  uniform float uFX;

  varying float vS;
  varying float vV;
  varying vec3 vNormal;

  float getAspect(float idx) {
    if (idx < 0.5) return uAspects[0];
    else if (idx < 1.5) return uAspects[1];
    else if (idx < 2.5) return uAspects[2];
    else if (idx < 3.5) return uAspects[3];
    else return uAspects[4];
  }

  vec2 coverUV(float ia, float rawU, float rawV) {
    vec2 uv = vec2(rawU, rawV);
    if (ia > uSegAspect) {
      float sc = uSegAspect / ia;
      uv.x = uv.x * sc + (1.0 - sc) * 0.5;
    } else {
      float sc = ia / uSegAspect;
      uv.y = uv.y * sc + (1.0 - sc) * 0.5;
    }
    return uv;
  }

  vec4 sampleTex(float idx, vec2 uv) {
    if (idx < 0.5) return texture2D(uTex0, uv);
    else if (idx < 1.5) return texture2D(uTex1, uv);
    else if (idx < 2.5) return texture2D(uTex2, uv);
    else if (idx < 3.5) return texture2D(uTex3, uv);
    else return texture2D(uTex4, uv);
  }

  void main() {
    float cs = vS + uScroll;
    float f = cs / uSegW;

    float rawIdx = floor(f);
    float idx = mod(rawIdx, uCount);
    if (idx < 0.0) idx += uCount;

    float u0 = fract(f);
    float u1 = gl_FrontFacing ? u0 : 1.0 - u0;

    float aspect = getAspect(idx);

    // Displacement: sine wave that travels with scroll, magnitude driven by uFX
    float dispV = sin(u1 * 4.5 + uScroll * 1.2) * uFX * 0.07;
    float dispU = cos(vV  * 3.5 + uScroll * 0.8) * uFX * 0.03;
    float ud = u1 + dispU;

    // 3-tap: spread unifies chromatic aberration + motion blur into one distance.
    // R from right tap, G weighted-average of all 3, B from left tap.
    float spread = uFX * 0.06;

    vec4 tapL = sampleTex(idx, coverUV(aspect, ud - spread, vV + dispV));
    vec4 tapC = sampleTex(idx, coverUV(aspect, ud,           vV + dispV));
    vec4 tapR = sampleTex(idx, coverUV(aspect, ud + spread,  vV + dispV));

    vec4 col = vec4(
      tapR.r,
      (tapL.g + tapC.g * 2.0 + tapR.g) / 4.0,
      tapL.b,
      tapC.a
    );
    col.rgb = mix(col.rgb, 1.0 - col.rgb, uFX);

    // Surface normal (raw, before flipping)
    vec3 rawN = normalize(vNormal);

    // Fresnel edge shadow — darkens at ribbon folds (edge-on to camera)
    float edgeShadow = smoothstep(0.0, 0.35, abs(rawN.z));

    // Lighting — flip normal for back faces so lighting is consistent
    vec3 N = gl_FrontFacing ? rawN : -rawN;
    vec3 L = normalize(uLightDir);
    float NdL = dot(N, L);
    float diffuse = NdL * 0.5 + 0.5; // half-Lambert
    diffuse = diffuse * diffuse;

    // Edge vignette along strip width
    float edge = abs(vV - 0.5) * 2.0;
    float vignette = 1.0 - edge * edge * edge * uEdgeVignette;

    float light = mix(uLightMin, uLightMax, diffuse * vignette * edgeShadow);

    // Analytical AA: fade alpha to 0 over exactly 1 pixel at top/bottom ribbon edges
    float dvV = fwidth(vV);
    float edgeAlpha = smoothstep(0.0, dvV, vV) * smoothstep(1.0, 1.0 - dvV, vV);

    gl_FragColor = vec4(col.rgb * light, edgeAlpha);
    #include <colorspace_fragment>
  }
`;

function FilmStrip({
  scrollRef,
  images,
}: {
  scrollRef: MutableRefObject<ScrollData>;
  images: readonly string[];
}) {
  const textures = useTexture(images as string[]);
  const matRef = useRef<THREE.ShaderMaterial>(null);

  for (const tex of textures) {
    tex.colorSpace = THREE.SRGBColorSpace;
  }

  const aspects = useMemo(
    () =>
      textures.map((tex) => {
        const img = tex.image as { width?: number; height?: number } | null;
        return img?.width && img?.height ? img.width / img.height : 1;
      }),
    [textures]
  );

  const config = useControls({
    strip: folder({
      segWidth: { value: 3.8, min: 0.5, max: 5, step: 0.1, label: "Seg Width" },
      stripH: {
        value: 2.2,
        min: 0.5,
        max: 6,
        step: 0.1,
        label: "Strip Height",
      },
      stripLen: { value: 32, min: 4, max: 60, step: 1, label: "Strip Length" },
    }),
    curve: folder({
      curveFreq: {
        value: 0.12,
        min: 0.01,
        max: 0.4,
        step: 0.01,
        label: "Sigmoid Steepness",
      },
      twist: { value: 3.55, min: 0, max: 6, step: 0.05, label: "End Twist" },
      flatZone: {
        value: 0.25,
        min: 0,
        max: 0.95,
        step: 0.05,
        label: "Center Flat Zone",
      },
      zDepth: { value: 3.2, min: 0, max: 4, step: 0.1, label: "Z Depth" },
    }),
    lighting: folder({
      lightX: { value: -0.8, min: -1, max: 1, step: 0.05, label: "Light X" },
      lightY: { value: 0.25, min: -1, max: 1, step: 0.05, label: "Light Y" },
      lightZ: { value: 1.0, min: 0, max: 2, step: 0.05, label: "Light Z" },
      lightMin: { value: 0.6, min: 0, max: 1, step: 0.05, label: "Light Min" },
      lightMax: {
        value: 1.0,
        min: 0.5,
        max: 1.5,
        step: 0.05,
        label: "Light Max",
      },
      edgeVignette: {
        value: 0.3,
        min: 0,
        max: 1,
        step: 0.05,
        label: "Edge Vignette",
      },
      backColor: { value: "#7A5C3E", label: "Back Color" },
    }),
  });

  const uniforms = useMemo(
    () => ({
      uTex0: { value: textures[0] },
      uTex1: { value: textures[1] },
      uTex2: { value: textures[2] },
      uTex3: { value: textures[3] },
      uTex4: { value: textures[4] },
      uScroll: { value: 0.0 },
      uSegW: { value: config.segWidth },
      uCount: { value: IMAGE_COUNT },
      uSegAspect: { value: config.segWidth / config.stripH },
      uAspects: { value: aspects },
      uAngle: { value: 0.0 },
      uAmp: { value: 3.0 },
      uFreq: { value: config.curveFreq },
      uZDepth: { value: config.zDepth },
      uStripH: { value: config.stripH },
      uTwist: { value: config.twist },
      uFlatZone: { value: config.flatZone },
      uLightDir: {
        value: new THREE.Vector3(config.lightX, config.lightY, config.lightZ),
      },
      uLightMin: { value: config.lightMin },
      uLightMax: { value: config.lightMax },
      uEdgeVignette: { value: config.edgeVignette },
      uBackColor: {
        value: new THREE.Color(config.backColor).convertSRGBToLinear(),
      },
      uFX: { value: 0.0 },
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [textures, aspects]
  );

  const { viewport } = useThree();
  const fxRef = useRef(0);

  useFrame(() => {
    if (!matRef.current) return;
    const u = matRef.current.uniforms;

    // Scroll
    const cycle = IMAGE_COUNT * config.segWidth;
    u.uScroll.value = scrollRef.current.progress * cycle;

    // Dynamic curveAmp: ribbon ends always touch viewport corners regardless of aspect ratio
    // Formula: rollY_at_end + strip_edge_offset = viewport half-height
    // rollY = amp*(1-cosθ),  strip_edge = (stripH/2)*cosθ  →  amp = (halfH - h*cosθ)/(1-cosθ)
    const cosT = Math.cos(config.twist);
    const halfH = viewport.height / 2;
    const dynamicAmp = (halfH - (config.stripH / 2) * cosT) / (1 - cosT);

    // Sync Leva values to uniforms every frame
    u.uSegW.value = config.segWidth;
    u.uSegAspect.value = config.segWidth / config.stripH;
    u.uAmp.value = dynamicAmp;
    u.uFreq.value = config.curveFreq;
    u.uZDepth.value = config.zDepth;
    u.uStripH.value = config.stripH;
    u.uTwist.value = config.twist;
    u.uFlatZone.value = config.flatZone;
    u.uLightDir.value.set(config.lightX, config.lightY, config.lightZ);
    u.uLightMin.value = config.lightMin;
    u.uLightMax.value = config.lightMax;
    u.uEdgeVignette.value = config.edgeVignette;
    u.uBackColor.value.set(config.backColor).convertSRGBToLinear();

    // FX: scroll-velocity driven chromatic aberration + photo negative
    const vel = scrollRef.current.velocity;
    const targetFX = Math.min(Math.abs(vel) / 800, 1);
    const lerpFactor = targetFX > fxRef.current ? 0.15 : 0.025;
    fxRef.current += (targetFX - fxRef.current) * lerpFactor;
    u.uFX.value = fxRef.current;
  });

  return (
    <mesh frustumCulled={false}>
      <planeGeometry args={[config.stripLen, config.stripH, 256, 32]} />
      <shaderMaterial
        ref={matRef}
        vertexShader={vertexShader}
        fragmentShader={fragmentShader}
        uniforms={uniforms}
        side={THREE.DoubleSide}
        transparent
      />
    </mesh>
  );
}

export function GalleryScene({
  scrollRef,
  gallery,
}: {
  scrollRef: MutableRefObject<ScrollData>;
  gallery: GalleryKey;
}) {
  return (
    <FilmStrip
      key={gallery}
      scrollRef={scrollRef}
      images={GALLERIES[gallery]}
    />
  );
}
