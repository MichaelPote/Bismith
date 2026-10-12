# FR3.2 — Path tracer

**Status:** done (v1)

## Goal
A progressive path tracer, written as our own fragment shader, specialised for height-field surfaces viewed
top-down, producing a linear HDR image (architecture §7).

## Plan
- Accumulation target RGBA32F (HalfFloat fallback), running mean; reset on material / lighting / render change.
- Analytic primary hit with sub-pixel jitter (or texel-centre sampling for crisp pixel art).
- Height-field ray march (≈1 px steps, escape test against max height, bisection refinement, wrap / plane edge).
- Lambert + GGX (Smith height-correlated, Schlick), stochastic lobe selection, VNDF sampling.
- NEE for directional and point lights with soft shadows; sky via BSDF rays; emissive on hit.
- Bounces 0–4, firefly clamp, deterministic PCG RNG (pixel × sample index × seed).
- Render settings: samples per frame, max samples, bounces, specular F0, sampling (jitter / texel centre),
  edge mode, clamp.
- Max height computed by readback after each material evaluation.
- Sample counter + time in the status bar; "Fast preview" (≤1 bounce, 1 spp per frame) while dragging.

## Checklist
- [x] Accumulation + reset logic
- [x] Primary hit + jitter / texel-centre modes
- [x] Height-field ray march with wrap / plane edge
- [x] Lambert + GGX BRDF with VNDF sampling
- [x] Directional + point light NEE, soft shadows
- [x] Sky + ambient + emissive
- [x] Multiple bounces — with Russian roulette
- [x] Firefly clamp, deterministic RNG
- [x] Progressive loop with sample budget + stats
- [x] Fast preview while interacting — draft mode — ≤1 bounce, 1 spp/frame — for 250 ms after each edit, then full quality restarts
