# FR8.1 — Texture term: VGG-19 Gram statistics

**Status:** done — on in the `tile` (weight 3) and `texture` (2) presets and in emulation; GPU only (drops out
where the network can't load, e.g. unit tests)

## Problem
The heaviest metric term, *structure*, compares pixels at the best circular shift. It rewards a layout that lines
up (a wall of 2×2 blocks) but reads every irregular pattern on another seed as unrelated — ≈ 0.63 for every
template on a stone wall and on hammered copper — so rankings fell to colour and contrast and preferred smooth
templates (marble) to the right family (rubble). Shift-invariant autocorrelation (raw, half-resolution, edge
magnitude) did not separate families: pixel speckle dominates 64 px palette textures.

## Design (`src/match/vgg.ts`)
- The standard texture descriptor of neural texture synthesis (Gatys et al. 2015): Gram matrices of VGG-19
  activations at conv1_1, conv2_1, conv3_1, conv4_1, at the native size. Distance = mean over the taps of
  ‖G − G_target‖ / (‖G‖ + ‖G_target‖) (0..1).
- **Colour-blind**: the render is histogram-matched (per channel) to the target first — the term measures shapes,
  scales and edges; colour stays the colour term's job (and FR8.2 fits it directly).
- GPU: feature maps are float textures `width × slices` by `height` (4 channels per texel); one pass per conv layer
  with constant loop bounds, weights as mat4 per tap in an RGBA float texture; 2×2 max pools; Gram on the GPU; only a
  per-row reduction of |G − G_target|² is read back. ≈ 8 ms per comparison on an RTX 5080 (first call compiles).
- Weights: `public/models/vgg19-conv4_1.{bin,json}` — conv1_1 … conv4_1 (3.5 M values, fp16, 7 MB), extracted from
  the Keras `vgg19_weights_tf_dim_ordering_tf_kernels_notop.h5` release (VGG-19, Simonyan & Zisserman, Oxford VGG,
  **CC BY 4.0**). Caffe preprocessing (BGR, ImageNet mean).
- `Matcher.texture` (a `TextureScorer` bound to the target) enables the term; `attachTexture(engine, matcher)` in
  `evaluate.ts` wires it for emulation, `harness optimize` and the Match workspace. Term scale 0.15.
- Headless `textureDistance(a, b, { colourMatch })` for checking the GPU network against a reference.

## Validation
numpy reference vs GPU (colour-matched, stone wall): rubble 0.140 / 0.145, bricks 0.160 / 0.170, marble 0.275 / 0.279,
greeble 0.266 / 0.264. Right family ≈ 0.14, wrong ≈ 0.27 (untuned templates), tuned results ≈ 0.10–0.13. With FR8.2 the
emulation screen picks a plausible family for 9 of 11 test targets (was 4): stone wall → rubble (was marble),
computer panel → greeble (marble), rock → rocky (cobbles), rusty panel → riveted (carpet), lava → caustics (blobs).
Still missed: hammered copper (carpet; its hammering is subtle under colour speckle) and carved stone (brushed wins
the race over carved).

Tried and not adopted (2026-10): sliced Wasserstein distances between the feature distributions instead of Gram
matrices, other input scales, and a higher texture weight — none ranked references better or improved optimised
results; see FR6.3, "A stronger texture term".

## Checklist
- [x] Weights extracted (fp16) + manifest; numpy validation
- [x] GPU network, Gram, reduction; parity with numpy
- [x] Metric term, presets, emulation / harness / Match workspace wiring
- [ ] Faster Gram (one pass per tap for both images) if evaluation time matters
