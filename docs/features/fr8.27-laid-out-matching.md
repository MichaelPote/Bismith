# FR8.27 — Laid-out references: a true-shift structure term, Bolts / Rivets, long runs

**Status:** done (2026-10-26) — the structure term compares every pyramid level at the true shift; Circle / Bolt is
**Bolts / Rivets** with the repeat's mirror split per axis; the Match workspace no longer grows per step. A _motifs_ term
was built and benchmarked but not adopted (below).

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
cells_ is two options on every shape with a repeat: **Mirror alternate columns** (`rep_mirror_x`) and **Mirror alternate
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

## Motifs term (tried, not adopted)

A term for the reference's small laid-out blobs (rivets, bolts, studs): extrema of a difference of Gaussians with a
Hessian edge-ratio test, each reference blob looking for the render's same-sign response within ±3 px at the best
wrap-around shift (log cost, too-strong answers capped at ½), plus a reverse part for render blobs the reference lacks,
the render's band-pass normalised to the reference's median level, and a weight scaled by how laid out the reference is
(the blob pattern's best self-repeat away from no shift: rock, wood, city wall, marble, lava, pipes, water → 0; brick
wall 0.05; bolted plate 0.66; grate 0.87; tiles 0.98; diamond plate, paving, stripes, riveted plates → 1).

On the riveted plates it did what it was for: shrinking the oversized rivets to the reference's size became the best
move (0.416 against 0.444 for keeping them and 0.479–0.499 for deleting or squashing them), and the 3000-step run kept
cleaner, evenly placed rivets (0.444 → 0.306). On the benchmark, the pairs it weighs got worse under Texture and Windows
(+0.034 ± 0.018 / +0.026 ± 0.023 over 18 paired runs; with the forward part only, +0.022 ± 0.012 / +0.016 ± 0.015
over 22): where the start project can't make the motif at all (a plain metal start for a bolted plate, a blank
start for paving or diamond plate), it pulls the search away from blob-like stand-ins the statistical terms reward. The
implementation and its calibration are kept with the private benchmark files.
