# FR8.19 — Windows metric (local texture)

**Status:** done — `windows` term; **Windows** preset (the Match workspace's default for references of 256 px and more)
and **Tile + windows** (`tilewin`, the default below); harness, `matchbench`. The older presets are unchanged and stay
selectable

## Problem

On a plank reference the Tile preset's biggest residual is the gaps between the planks: where they fall. That is
layout — the number of planks, the end joints, the stagger — and the optimiser can't fix it by tuning, nor does it
matter to whether the render _reads_ as the reference. Measured on a plank project against a re-seeded copy of itself
(nothing lines up), the old metrics price layout above texture:

| change (same material)                                                               | Tile      | Texture   | VGG term  | windows term |
| ------------------------------------------------------------------------------------ | --------- | --------- | --------- | ------------ |
| layout: plank count, joints, stagger, width variation, joint randomness (5 variants) | 0.28–0.46 | 0.16–0.39 | 0.19–0.45 | 0.17–0.21    |
| fine grain removed (_Fine_ and _Grain depth_ down)                                   | 0.39      | 0.30      | 0.36      | 0.30         |
| grain noise layers off                                                               | 0.30      | 0.18      | 0.24      | 0.36         |
| chips & splits off                                                                   | 0.34      | 0.25      | 0.27      | 0.20         |

Tile's _structure_ term is ≈0.58 for every one of them — the floor of a stochastic material, whatever changed — and at
the 128 px comparison size the VGG term mostly sees the gaps and joints (a different plank count costs more than the
grain disappearing). The global terms also run at 128 px, where a 768 px reference's fine grain is gone.

## Design (`src/match/windows.ts`)

Patch-based _bidirectional similarity_ (Simakov et al. 2008), with statistics instead of raw pixels per patch:

- Render and reference are compared at up to **512 px** (`windowMaxSize`), separately from the other terms' 128 px.
- **Windows** of ⅛ of the short side (`windowFraction`; a power of two, 16…128 px — 64 px at 512) are cut on a grid at
  half-window steps (wider where that would exceed 16 windows across, so matching stays ≤ 256 × 256 pairs — Fine
  windows at 512 px don't overlap), wrapping for tileable projects. Statistics are summed per _cell_ (¼ window) and a
  window adds its 4 × 4 cells, so dense banks are cheap.
- Per window: **colour** — cumulative histograms of OKLab L, 2a, 2b (24 bins over the reference's range; W1, ≈ΔE);
  **edges** — Sobel log-magnitude histogram (EMD in octaves) and magnitude-weighted _directed_ orientation histogram
  (circular EMD — the lighting direction counts), as the global gradient term; **detail** — log10 mean |oriented
  derivative| at 0°, 45°, 90°, 135° on up to four pyramid levels. Part distances map to 0..1 by `raw / (raw + scale)`
  and are mixed colour 1, edges 3, detail 1 (`DEFAULT_WINDOW_WEIGHTS`).
- **Matching:** every render window's distance to its nearest reference window (_coherence_: nothing in the render that
  the reference lacks) and every reference window's to its nearest render window (_completeness_: nothing of the
  reference missing). The term is their mean, already 0..1, reported as it is.
- Positions are a fixed grid, not drawn at random per evaluation: candidates are compared by their scores, and fresh
  windows each time would make that noise.
- Nearest-neighbour matching ignores _how often_ a kind of window occurs (more knots than the reference still match),
  so the preset keeps the global colour distribution beside it. That is what leaves the layout free; balanced matching
  (entropic optimal transport, Sinkhorn, uniform marginals — ≈6 ms) makes the frequencies count but prices the layout
  again (three end joints instead of one: 2.4× the floor, other plank counts and joint layouts up to 1.9×), so it
  wasn't adopted. Against the reference, 3, 4 and 6 planks score 0.343 / 0.337 / 0.340: no pull towards fewer gaps.

**Preset `windows`:** colour 1, texture (VGG) 1, windows 4 (+ alpha). No structure or spectrum — they see where the gaps
and joints fall. The VGG term reads them too at 128 px, but at weight 1 it costs the windows term nothing and keeps
tone and coarse texture from drifting (_Results_).

**Preset `tilewin`:** Tile's weights plus windows 3 — Tile's structure term keeps the layout of a laid-out game texture,
the windows term gives a big reference's fine detail a say.

**Match workspace.** _Metric → Tile + windows · Windows (local texture) · Tile · Texture · Layout_, with _Window_ Fine
(1/16) · Medium (1/8) · Coarse (1/4) for the two with windows. A loaded reference picks the metric by its size —
Windows from 256 px on the long side, Tile + windows below (small game textures, where the layout counts too, see
_Results_) — until a metric is picked by hand. The
third pane shows the **window mismatch** map instead of the pixel difference: the render dimmed to grey under a heat
overlay of how far the windows covering each pixel are from their closest reference windows (clear = well matched,
red → yellow = the worst-matched windows of this render; relative to its own best and worst, so it shows where, not
how much). Changing the metric rescores the panes. `Matcher.windows(render)` / `windowMap(render)` give the
per-window result and the map. On the plank project the gaps and joints come out clear — matched — and the noisy grain
inside the planks is what lights up.

**Cost.** ≈85 ms per evaluation at 512 px (a 768 px render: one conversion to linear light shared by both comparison
sizes, `resampleLinearToOklab` straight to the windows' OKLab planes; 256 × 256 window pairs), against ≈40 ms for the
Tile preset's CPU terms.

## Validation

Synthetic planks (`windows.test.ts`): identity and whole-step shifts score 0; a different plank layout scores below
smooth or coarser grain; the term rises with noise and blur; non-tileable, non-square images are covered.

Calibration at 512 px (plank render vs reference and degradations): noise ±0.02 / 0.05 ≈ 0.14 / 0.34, blur r 1 / 2 ≈
0.38 / 0.51, the reference zoomed 2× ≈ 0.45, unrelated photos (concrete, brick, metal, dark fine wood) 0.59–0.73.
Re-seeded renders of ten materials scored against the original: the right one nearest for 9 of 10 (the miss is a
material whose re-seed changes its colours), self ≈ 0.11–0.21 against ≥ 0.4 for most others.

Tried and dropped: an FFT spectrum per window (Hann-windowed periodograms are noisy — an 8 px offset of the same image
scored 0.19), local-contrast histograms (linear or log std; noisy, and the edges part already sees contrast), and
gradient-strength histograms on coarser pyramid levels (raised the floor). Bigger windows (128 px at 512) separate
texture changes better but start pricing the layout again (a plank-joint change +45 % over the layout floor); 32 px
windows halve the separation (and, overlapping, would cost 16× the matching).

## Results

Optimiser runs of 300 steps (≈1200 evaluations, the Match workspace's settings), scored afterwards under Tile, Texture
and Windows (`matchbench`; the Windows column there is colour + windows term, without VGG). Paired means ± s.e.

**The plank project against its 768 px painted-plank reference** (4 seeds):

| optimised with                            | Tile  | Texture | Windows |
| ----------------------------------------- | ----- | ------- | ------- |
| (start)                                   | 0.296 | 0.187   | 0.289   |
| Tile                                      | 0.284 | 0.169   | 0.283   |
| colour + windows                          | 0.355 | 0.230   | 0.168   |
| colour + windows, Coarse windows (¼)      | 0.346 | 0.227   | 0.182   |
| **colour + windows + VGG 1 (the preset)** | 0.304 | 0.184   | 0.172   |

Tile hardly moves this project — its floor is the layout. With the windows term the renders lose what the reference
doesn't have (red streaks, speckled noise grain, dots) and take on smoother, painted-looking grain; with the windows
term alone they drift lighter and cloudier (the _Blotches_ layer supplies the reference's tone variation, which the
windows can't tell from per-plank tone — removing it raises colour and windows), and the VGG term at weight 1 holds
tone and coarse texture near the start at no cost to the windows term (+0.004 ± 0.002).

**15 dev pairs** (game textures at 64 px and the 768 px plank reference, 2 seeds), against optimising with Tile:
colour + windows: Tile +0.080 ± 0.007, Texture +0.070 ± 0.007, Windows −0.026 ± 0.007; with VGG 1: Tile
+0.042 ± 0.006, Texture +0.036 ± 0.006, Windows −0.026 ± 0.007 (VGG against no VGG: Windows +0.000 ± 0.003, Tile and
Texture −0.04 each, better on 14 of 15 pairs). On small game textures Tile-optimised results already score nearly as
well on the windows term, and match the layout besides; by eye the Windows results are on a par (better floorboards and
pipes, worse on a circuit board and on hammered copper for one seed each). Hence the default by reference size.

**Tile + windows and a schedule** (the same 15 pairs plus the plank project, 2 seeds each, rerun on the current code;
paired against optimising with Tile, so the Windows column here is the Windows preset, VGG included):

| optimised with                   | Δ Tile         | Δ Texture      | Δ Windows      | plank project: Windows |
| -------------------------------- | -------------- | -------------- | -------------- | ---------------------- |
| Tile                             | —              | —              | —              | 0.278                  |
| Windows                          | +0.039 ± 0.007 | +0.037 ± 0.007 | −0.006 ± 0.006 | 0.189                  |
| Tile + windows 3 (`tilewin`)     | +0.005 ± 0.005 | +0.005 ± 0.006 | −0.007 ± 0.006 | 0.193                  |
| Tile 150 steps, then Windows 150 | +0.017 ± 0.003 | +0.016 ± 0.004 | −0.014 ± 0.005 | 0.193                  |

Tile + windows ties Tile on its own metrics and ties Windows on the windows score (better than Windows on Tile and
Texture by −0.034 / −0.032); the schedule lands between. By eye, on the 64 px textures it is on a par with Tile (a
little better on the floorboards, circuit board and grate for one seed each, worse on lava — both seeds holed or too
yellow, its worst pair, +0.089). On the plank project it smooths the grain but keeps the red streaks Tile keeps;
Windows alone is the one that drops them and moves to the painted look. So Tile + windows is the default for small
references and Windows for big ones.

## Checklist

- [x] Window banks, bidirectional matching, mismatch map
- [x] `windows` term and preset; Matcher at two sizes from one linear conversion
- [x] Match workspace: preset, window size, mismatch pane
- [x] Harness / matchbench: `--preset windows`, Windows score in every row
- [x] Unit tests
