# Anime Impact Frame — Effect Reference

## Overview

A video plays on a fullscreen WebGL quad. When the user **holds mouse click**, an anime
impact frame effect progressively builds with cubic ease-in (slow start, fast end). At
full hold, it erupts into a manga-style impact frame. On release, everything snaps back
with damped spring physics.

---

## Video Source

A single "stacked" 1920x1080 MP4 containing four 960x540 quadrants:

```text
+----------+----------+
|  Color   |  Depth   |   top row (UV y: 0.5–1.0)
+----------+----------+
|   Mask   | Lineart  |   bottom row (UV y: 0.0–0.5)
+----------+----------+
```

- **Color** — original video frames
- **Depth** — grayscale depth map (white = close, black = far) via Video Depth Anything v2
- **Mask** — binary subject mask (white = subject) via SAM2
- **Lineart** — manga-style line art via ControlNet lineart_anime

GLSL sampling:

```glsl
vec4 sampleColor(sampler2D s, vec2 uv)    { return texture2D(s, uv * 0.5 + vec2(0.0, 0.5)); }
float sampleDepth(sampler2D s, vec2 uv)   { return texture2D(s, uv * 0.5 + vec2(0.5, 0.5)).r; }
float sampleMask(sampler2D s, vec2 uv)    { return texture2D(s, uv * 0.5 + vec2(0.0, 0.0)).r; }
float sampleLineart(sampler2D s, vec2 uv) { return texture2D(s, uv * 0.5 + vec2(0.5, 0.0)).r; }
```

---

## Interaction Model

**State machine:** `idle` → `building` → `peak` → `reverting` → `idle`

- **Building**: mousedown starts. `progress = (elapsed / holdDuration)^3` (cubic ease-in).
  Max hold duration ~2s (Leva-tunable).
- **Peak**: fires when progress >= 1.0. One-shot GSAP tweens trigger flash/particles/text.
- **Reverting**: mouseup triggers damped spring (stiffness=180, damping=12). Fast snap with
  slight overshoot below 0 (clamped), then settle.
- Click position stored as UV — drives zoom center, speed lines origin, crack origin,
  particle burst origin.

Re-clicking during revert resumes building from current progress.

---

## Phase 1: Build-up (hold progress 0 → 1)

Effects activate at **staggered thresholds** (not all at once):

| Effect              | Start | End  | Description                                             |
|---------------------|-------|------|---------------------------------------------------------|
| Video slowdown      | 0%    | 10%  | `playbackRate` 1.0 → 0.05 (near-freeze)                |
| Desaturation        | 10%   | 20%  | Depth-aware: background desaturates first               |
| Contrast            | 15%   | 30%  | Shadow crush + highlight blow (`pow` curve)             |
| Zoom                | 20%   | 40%  | Subtle push-in toward click point (UV distortion)       |
| Vignette            | 25%   | 45%  | Radial edge darkening, tunnel vision                    |
| Film grain          | 30%   | 50%  | Animated hash-based noise                               |
| Chromatic aberration | 40%   | 60%  | R/B channel offset — image "vibrates"                   |
| Screen displacement | 50%   | 70%  | CPU-computed shake vector, subtle trembling              |

Each effect's local intensity: `localT = clamp((progress - start) / (end - start), 0, 1)`
then eased (ease-out-quad for most).

---

## Phase 2: Peak Impact (progress = 1.0)

All fire simultaneously:

| Effect              | Duration | Description                                            |
|---------------------|----------|--------------------------------------------------------|
| White flash         | ~100ms   | Additive overexposure spike then fade                  |
| Style swap          | Instant  | Cross-fade from video → lineart quadrant               |
| Background knockout | Instant  | Where mask=0: replace with speed lines / solid color   |
| Bold ink outlines   | Instant  | Sobel edges on luminance, masked to subject, thickened |
| Radial speed lines  | ~200ms   | From click point, depth-aware (behind subject)         |
| Screen cracks       | ~150ms   | Voronoi hairline fractures from click point            |
| Screen shake        | ~300ms   | Sharp directional, fast dampened                       |
| Ink particles       | Instant  | 150 ink-splatter particles burst from click point      |
| Halftone dots       | Instant  | Ben-Day dots on shadow regions                         |
| Onomatopoeia        | ~200ms   | Japanese SFX text slams in (scale overshoot)           |

### Speed Lines Detail

Procedural radial lines in fragment shader:
- Polar coords from click point
- Angular frequency for line count (~40 lines)
- Radial falloff (no lines near origin, strong at edges)
- Inverted mask multiplication (lines go BEHIND subject)
- Animated outward motion

### Screen Cracks Detail

Voronoi cell edges + radial alignment:
- Voronoi pattern centered on click point
- Crack = distance to nearest cell boundary
- Radial falloff from origin (spread radius tunable)
- Two layers: primary (coarse) + secondary (fine, 2x frequency)
- White hairlines with subtle blue-tinted glow

### Ink Particles Detail

R3F `<Points>` with custom ShaderMaterial:
- 150 particles, all emit from click point simultaneously
- Radial burst velocities + gravity + exponential drag
- Fragment: noise-deformed circles for irregular ink splatter shape
- ~800ms lifetime, fade over last 50%

### Onomatopoeia Detail

HTML overlay (not WebGL):
- Random: ドドドド, バキッ, ドゴォ, ズドン, ガッ, ドカーン, ゴゴゴゴ
- Font: Noto Sans JP, weight 900, white with black stroke
- GSAP: `scale: 3→1, ease: "back.out(3)"` over 150ms
- Positioned offset from click point (screen coords)

### Halftone Detail

Procedural Ben-Day dots:
- Rotated grid (45 degrees for authentic manga look)
- Dot radius proportional to inverse luminance (dark = big dots)
- Applied only where luminance < threshold
- Dot size ~4px tunable via Leva

---

## Phase 3: Revert (mouse release → spring back)

Spring physics: `stiffness=180, damping=12, mass=1`

| Behavior                      | Detail                                              |
|-------------------------------|-----------------------------------------------------|
| All effects decay             | Follow main spring progress                         |
| Color return wave             | Circle expanding from click point, restoring color  |
| Speed lines retract           | Negative animation speed (inward motion)            |
| Video playback overshoot      | Springs to 1.3x briefly, then settles to 1.0x      |
| Afterimage ghost              | Previous frame at reduced alpha, fades quickly      |
| Text fade                     | Scale 1→0.8, opacity 1→0, ease: "power2.in"        |
| Particles fade                | Natural lifetime decay (already fading at ~800ms)   |

---

## Shader Architecture

### Render pipeline (per frame, in order)

1. **Buildup FBO** (full res) — Sample color quadrant, apply all Phase 1 effects
2. **Edge Detection FBO** (half res) — Sobel on luminance, masked to subject
3. **Speed Lines FBO** (half res) — Radial lines, masked by inverted subject
4. **Screen Crack FBO** (half res) — Voronoi pattern from click point
5. **Composite pass** (screen) — Merge all layers + halftone + flash + style swap

### Shared fullscreen vertex

```glsl
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
```

---

## Leva Controls (folder structure)

```text
Impact Frame
├── buildup
│   ├── holdDuration      (2.0s, 0.5–5.0)
│   └── easingPower       (3, 1–5)
├── desaturation
│   ├── desatMax          (0.9, 0–1)
│   └── desatDepthBias    (0.7, 0–1)
├── contrast
│   ├── contrastMax       (2.0, 0–4)
│   └── shadowCrush       (0.3, 0–1)
├── zoom
│   └── zoomMax           (0.15, 0–0.5)
├── vignette
│   ├── vignetteMax       (0.8, 0–1)
│   └── vignetteRadius    (0.4, 0.1–0.8)
├── grain
│   └── grainMax          (0.15, 0–0.5)
├── chromatic
│   └── caMax             (0.01, 0–0.05)
├── shake
│   ├── shakeMax          (0.02, 0–0.1)
│   └── shakeFreq         (30, 5–60)
├── peak
│   ├── flashDuration     (0.1s, 0.05–0.5)
│   └── flashIntensity    (1.0, 0–2)
├── speedLines
│   ├── lineCount         (40, 10–100)
│   ├── lineThickness     (0.3, 0.1–0.8)
│   └── lineSpeed         (2.0, 0–5)
├── cracks
│   ├── crackSpread       (0.6, 0.1–1.5)
│   └── crackDensity      (12, 4–24)
├── edges
│   ├── edgeThickness     (2.0, 0.5–5)
│   └── edgeThreshold     (0.1, 0–0.5)
├── halftone
│   ├── dotSize           (4.0, 1–10)
│   └── dotAngle          (0.52, 0–1.57)
├── particles
│   ├── particleCount     (150, 50–300)
│   ├── burstSpeed        (1.5, 0.5–4)
│   └── particleGravity   (2.0, 0–5)
├── text
│   ├── fontSize          (64, 24–120)
│   └── textScale         (3.0, 1–6)
└── spring
    ├── stiffness         (180, 50–400)
    ├── damping           (12, 4–30)
    └── playbackOvershoot (1.3, 1.0–2.0)
```

---

## Pre-Processing Pipeline

Lives in `pipeline/` at project root. Python + ffmpeg.

### Steps

1. `extract_frames.py` — ffmpeg scales to 960x540, outputs numbered JPEGs
2. `depth_estimation.py` — Video Depth Anything v2 (Small), grayscale output
3. `segmentation.py` — SAM2 (hiera_small), point prompt on frame 0, auto-propagate
4. `style_transfer.py` — ControlNet lineart_anime, black lines on white
5. `pack_output.py` — ffmpeg xstack filter, 4 streams → 1920x1080 MP4

### Usage

```bash
conda activate anime-fx
python process_video.py input.mp4 -o output/ -p 480 270
# → output/packed.mp4
```

Copy `packed.mp4` to `public/videos/impact-stacked.mp4`.
