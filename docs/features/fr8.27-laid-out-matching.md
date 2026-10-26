# FR8.27 — Laid-out references: a true-shift structure term, Bolts / Rivets, long runs

**Status:** done (2026-10-26) — the structure term compares every pyramid level at the true shift; Circle / Bolt is
**Bolts / Rivets** with the repeat's mirror split per axis; the Match workspace no longer grows per step; an opt-in
**Tile + motifs** metric (`src/match/motifs.ts`) holds a laid-out reference's rivets, bolts and studs.

## Problem

A Match run on a 64 px riveted-plate game texture (two plates, 4 × 8 rivets on an exact 8 px period, dark rusty metal)
left overnight with the default Tile + windows metric "consistently moved away from the reference": by step 250 the
rivets had faded to specks, by step 3000 they were gone and the plates were sliced into thin strips — while the loss
kept falling (0.518 → 0.394). Tile, Windows and Layout all failed the same way, and the desktop's GPU hitched. Measured:

1. **The structure term wasn't shift invariant.** It built the box pyramid once and shifted the coarse levels by
   `round(d / 2^l)`, comparing box averages of different pixels: the reference against itself moved by 1 px scored
   0.28 — as bad as the reference with its rivets removed (0.29). Features a pixel off were charged as if missing, so
   deleting small features beat keeping them.
2. **The start's rivet rows weren't evenly spaced.** _Mirror alternate cells_ mirrored rows as well as columns: with
   the rivets just off their cell centre, alternate rows moved by ±0.34 px and the highlight jumped between pixel rows.
   Mirroring only columns (pairs of rivet lines along each plate's edges) was not possible.
3. **A feature's credit depends on everything else matching.** On a render whose tone and grain were still off,
   correct rivets were worth ≈0.014 of the total over none (≈0.12 once the rest matches), less than one duplicated
   weathering layer; the start's rivets were about 2× too big and bold, so shrinking them paid at first.

The windows, spectrum and VGG terms do rank correct rivets above none on the reference itself.

## Structure term

`shiftedZPyramid` (metrics.ts) shifts the reference at full resolution and reduces it again for each candidate shift
(cached per shift — the reference never changes, and renders land on a few shifts). Every level compares the same
pixels: any circular shift of an image scores 0 against it (test: _finds the structure at any wrap-around shift_), and
the start project's structure raw value dropped from 0.968 to ≈0.77.

## Bolts / Rivets

The Circle / Bolt generator is labelled **Bolts / Rivets** (type `circle` unchanged), and the repeat's _Mirror alternate
cells_ is two options on every shape with a repeat: **Mirror odd columns** (`rep_mirror_x`) and **Mirror odd
rows** (`rep_mirror_y`). A 2-column repeat mirrored in X alone puts a rivet line along both edges of a plate while its
rows stay evenly spaced. Presets that had the mirror on have both; an old project's `rep_mirror` is dropped on load
(nothing is released, so there's no migration).

With both changes, the same 3000-step run from the start project (columns mirrored only) keeps all 32 rivets and both
plates (Tile + windows 0.444 → 0.335; before: rivets gone by step 250).

## Long runs in the Match workspace

An overnight run (30 000 steps) grew three things every step: the loss chart (an SVG path with a point per step, behind
a drop-shadow filter, rebuilt and rasterised each step), the curve array (a deep reactive array copied each step) and
the optimiser's step history (about 0.4 KB a step, written to the run's IndexedDB checkpoint every 10 s — ≈12 MB per
save by morning). The chart now draws at most two points per unit of its width (the best loss only falls, so a bucket's
last value keeps the shape), the curve is a shallow ref, and `Optimizer.history` keeps the last `HISTORY_STEPS` (2000).
Headless runs showed no GPU-object growth before or after (three.js textures flat over 3000 steps).

## Benchmark

`matchbench`, strategy as the workspace runs it (Tile + windows, λ 4, colour range 0.06, layers + base + shading +
lights, structural moves, 3000 evaluations), dev (15 pairs × 2 seeds) and test (6 pairs × 4 seeds), each arm in its own
worktree; both arms have the mirror split. Judged under the Texture and Windows presets, which the change doesn't touch
(Tile's own score changes with it), paired Δ (negative = better):

| set       | Texture        | Windows        |
| --------- | -------------- | -------------- |
| dev (30)  | −0.003 ± 0.009 | −0.010 ± 0.010 |
| test (24) | +0.005 ± 0.009 | +0.007 ± 0.007 |
| all (54)  | +0.001 ± 0.006 | −0.002 ± 0.006 |

Neutral on the benchmark; it fixes the failure above.

## Tile + motifs (opt-in)

Preset `tilemotif`, _Metric → Tile + motifs (rivets, bolts)_ in the Match workspace: Tile + windows plus a **motifs**
term at weight 4. Never picked automatically; every other preset weighs it 0 and doesn't compute it (their scores are
bit-identical with and without the term). Meant for someone who has set the project up by hand so it already makes
the reference's motif roughly right, and wants the search to finish the material without trading the motif away.

The term (`src/match/motifs.ts`), at the comparison size, on OKLab L:

- **Blobs:** a difference of Gaussians (σ 0.8 − 2 px), extrema of either sign above 0.4 × the reference's 99th
  percentile |response|; a ridge (seam, plate edge) is dropped by the Hessian edge-ratio test (ratio 6). Each blob
  weighs min(1, amp / p99)², so the motif's strong blobs outweigh the speckle's.
- **Normalised to the texture:** the render's response is scaled by (reference median |response|) / (render median) —
  its speckle level, which a few rivets don't move — so a render whose grain is twice as contrasty doesn't have every
  blob charged twice (contrast is the other terms' job).
- **Shift:** the wrap-around shift where the 64 strongest reference blobs best meet the render's response (the
  cheapest of the top three); none for non-tileable projects.
- **Forward:** each reference blob takes the render's strongest same-sign response within ±3 px of its place, falling
  off with distance (σ 1.5 px). Cost 0 at the right strength, 1 at a quarter of it or less (speckle nearby — the blob
  is missing), log-linear between; a too-strong answer costs at half the slope, at most ½.
- **Reverse:** the render's own blobs, phased in by amplitude, charged only for _absence_ in the reference, never for
  being bolder than it.
- **raw** = ½ forward + ½ reverse, already 0..1.
- **Layout gate:** the reference's blob pattern correlated with itself at every shift outside ±3 px; the best repeat
  relative to no shift, r, gives `layout = clamp((r − 0.45) / 0.3, 0, 1)`, and the term's weight is 4 × layout. On the
  benchmark references: rock, wood, city wall, marble, lava, pipes, water and photo planks → 0 (the preset is then
  Tile + windows); brick wall 0.05; bolted plate 0.66; grate 0.87; tiles 0.98; diamond plate, paving, warning stripes
  and riveted plates → 1. ≈2–3 ms per evaluation at 64².

Calibration on edits of the riveted-plate reference (raw): rebuilt 0.067; speckle re-seeded 0.16; rivets moved 1 px
0.15; rivets 2× bolder / bigger 0.18 / 0.15; rivets removed / faint 0.37 / 0.35; alternate rows offset 0.31; columns
evenly spaced instead of paired at the edges 0.34. From the start project, shrinking the oversized rivets to the
reference's size became the best move (total 0.416, against 0.444 to keep them and 0.479 / 0.499 to delete or squash
them), and a 3000-step run kept clean, evenly placed rivets (0.444 → 0.306; Tile + windows with the structure fix:
0.444 → 0.335, smaller rivets, slightly jittered rows).

**Why it isn't a default.** With the term inside Tile + windows (the setup under Benchmark), the laid-out pairs got worse under
Texture and Windows (+0.034 ± 0.018 / +0.026 ± 0.023 over 18 paired runs; with the forward part only, +0.022 ± 0.012 /
+0.016 ± 0.015 over 22): where the start project can't make the motif at all (a plain metal start for a bolted plate, a
blank start for paving or diamond plate), it steers the search away from the blob-like stand-ins the statistical terms
reward. Where the start has the motif (rivets, a grate, tiles) it held it.

Tried and dropped while building it: a hard keypoint chamfer (jumped when a blob crossed the threshold; seams made
strings of extrema); a symmetric log cost with a ±2 px / σ 1 px reach (oversized rivets 1.5 px off scored as badly as
none, and the first run squashed them away); normalising by the 99th percentile (the rivets set it, so deleting them
boosted the speckle and hid their absence).
