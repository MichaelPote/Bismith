# FR8.29 — Splits

**Status:** done, with open flaws (see _Open_)

## Goal

Checked and split timber: the wood pulled apart along its own lines. A split in a board runs along a ring, where the
latewood meets the earlywood, opens widest where the strain is greatest and narrows to a point either way; the wood
either side moves apart to make room, the lips round over, and the floor is dark. It had to follow the lines that are
actually there — curving round knots and with the figure — not lanes of straight cracks drawn over the grain, so it is a
**filter** that reads the layers below and resamples every channel: the colour, height, roughness and glow split
together. (It replaces Cracks' Wood material, FR8.17, which drew chips, straight splits and nicks.)

Source: `src/layers/filters/splits.ts` (type `splits`, in the add menu after Cracks).

## How it works

1. **Weak lines** (pre-pass). The source — Diffuse's lightness (sRGB) or Height — blurred at the _Line width_ less
   the same blurred at 3× it: positive along the middle of a dark line (_Gives way along_ › Dark lines; Light lines the
   other way; Edges the slope). Both blurs are normalised convolutions inside the _Keep inside_ mask, and the weakness
   fades out over two line widths from its edges, so a dark gap and the shading beside it don't read as a line of the
   wood (splits ran along the joints). The **structure tensor** (the wide blur's gradient², blurred again) gives the
   lines' direction, and its fourth component the weakness² round about: a line is judged against its neighbours.
2. **Along the lines** (pre-pass): a streamline through each pixel follows the tensor both ways, held within ~60° of the
   _Grain_, stopping where it leaves the piece (outside the mask, or in reach of an edge that faces along it — a step can
   jump a 1 px gap). Along it: the weakness averaged over ≤ 24 px in ~1 px steps (coarser steps alias the fine grain);
   the **strain** — noise about _Split spacing_ across, averaged over half a _Split length_ (a line-integral convolution:
   streaks that curve with the rings), plus _Round knots_ × the lines' curvature averaged the same way (counted only
   while the streamline follows the lines); a noise a third as fine (one random per line); how far the piece's end lies
   along the line (interpolated, so it moves smoothly with the pixel).
3. **Give way** (pre-pass): strain + _Amount_ − 1 − _Line strength_ × how faint the line is + the line's random (so the
   Seed reorders which win), plus _Splits from ends_ near an end on the lines its random picks; less 1 where a line turns
   more than ~55–70° off the Grain or comes within a margin of the piece's sides (shrinking to ½ px at its ends). Then
   **eroded along the line by a cone**: the least, over the streamline, of the excess there + slope × distance (−1 past
   where the line stops or turns > 80°). Every split tapers linearly to wherever its line stops giving way (fully open
   about _Ltip_ px in, from _Taper_: the cone's slope, 0.6 × tl / Ltip with tl = 0.03 + 0.15 × Taper, takes a line's
   usual excess of ~0.05–0.1 about that long to reach — at tl / Ltip with tl 0.27 it rose in 2–3 px, which read as
   square ends), stretches shorter than ~4 Widths stay shut, and the result is continuous — run lengths measured from
   the pixel, the first try, jumped wherever the excess dipped to zero there.
4. **Strain relief** (pre-pass, between two erosions). Per pixel, as if a line ran through it, the lines either side
   across (local maxima of the weakness within a few lines' spacing) each relieve it by 1.5 × their opening as a share
   of the Width (the once-eroded excess at their centres), less with distance, judged softly over ±0.6 of the Width
   (wider relieves narrower); the result goes back to an excess and is **eroded again**, so where a stronger split
   takes over, the relieved one tapers out. (Relief in the layer's pass, per pixel after the erosion, made those
   hand-overs square heads.)
5. **Opening** (the layer's pass). Each pixel searches across the lines (the tensor's direction; the Grain's where the
   lines are unclear or nearly across it, where "across" flips from row to row) for local maxima of the weakness,
   centred by a parabola and re-fitted at half-pixel spacing (the search step's error notched wide lips into teeth),
   within R + Width·(1 + variation) + 2 px: everything that can reach the pixel. Each line opens by _Width_ (_Dent width_
   in Dent style) × its own variation × excess / taper (linear, so tips are points — a power under 1 rounded them and magnified a fading tail's noise into combs), the excess read as the most within ¾ px across the line (each pixel's estimate of the centre differs a little), × how far it stands above the lowest weakness within 3
   line widths either side (its prominence: a line splitting off a neighbour at an arch tip opens from nothing).
6. **Pull apart** (_Style_ › Split open). The material either side moves away from the line by half the opening (each lip
   its own ragged half: _Raggedness_), fading out over _Push apart_ px. The opening reads the line itself; a _Bevel_
   rounds each lip down into it (_Profile_); the floor is a V, deeper and darker towards the middle. **Dent** moves
   nothing: the split is a soft dish in the height across its width and bevel, the colour kept (Depth 0.35, Darken 0.15
   by default there). Either way the colour × the _Gap colour_ by _Darken_ (0.35: brown, not black; in sRGB), _Darken
   bevel_ how far up the bevel; height sinks by _Depth_ × √(opening / Width) × the split's own _Depth variation_
   (from the line's random, through a sine so it doesn't follow the width); _Roughness Δ_; _Nearest pixel_ for pixel art.

Splits stay in the _Keep inside_ mask's pieces (Shape by default: Wood's planks). A mask that holds no distance (a
Feather, a painted coverage) gets one by jump flood.

## Cost

Cold compile on D3D11 (RTX 5080), all its shaders, measured as a salted first render: ~0.8 s (before the later rounds;
not re-measured). Per pixel ~32 ms per layer at 2048² (`tools/render-cost.ts`, after relief moved to a pre-pass; it was
16–24 ms before; the measure is noisy — Warp read 0.65–8.5 ms across runs). Seven small pre-passes plus three blurs;
the layer's own search is ~30–40 bilinear samples at the defaults.

## Presets

_Wood planks_ (Source › Height: its colour is mostly short fibres and scratches, which give way in specks), _Split
timber slab_ (Height, Line width 6) and the _Wood_ group (Diffuse) use it at the end of their stacks.

## Open

Five critic rounds after the first (5.5 → 6.3 → 6.7 → 6.6 → 6.9 → 6.9). Where it stands: strain relief now runs in a
pre-pass, so hand-overs taper; a square end can still appear where a fading line merges into its neighbour (its centre
found half a pixel apart from row to row lands on a steep excess); a few glyph-like end checks on planks; knots get no
splits of their own; Edges mode makes dotted ladders; Dent at a fixed small Width is faint on large textures. It writes
no mask (filters don't): dirt in the splits needs a Mask area over the relief.

## Checklist

- [x] Weak-line, tensor, streamline (weakness, strain, per-line random, end distance) and give-way pre-passes
- [x] Search across the lines, taper, strain relief, push apart, ragged bevelled lips, gap colour and depth
- [x] Keep inside a mask (jump flood for feathered ones), checks from the ends
- [x] Cracks lost its Wood material; presets moved to Splits; previews regenerated
- [x] Tests (registry, axes, fresh sizes, no `continue`), D3D11 compile and cost measured
- [x] Style (Split open / Dent), Darken, Depth variation, Round knots, Raggedness
- [x] Five critic rounds
