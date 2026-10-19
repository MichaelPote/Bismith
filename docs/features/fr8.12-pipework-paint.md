# FR8.12 — Pipework and peeling paint

**Status:** done (first pass on materials) — _Pipework_ generator, _Glass_ filter, _Pipes_ (seven finishes) and
_Peeling paint_ lumps; tried against two photographs of rusty pipes on painted walls (panels; bricks)

## Pipework generator (`layers/generators/pipes.ts`, `pipesGeometry.ts`)

Pipe runs as true cylinders — the value is the surface height, so the lights shade them round and they cast shadows.

- **Runs**: _Drawn_ — centre-line polylines in a `points` param (px or fractions), edited with the shape editor;
  an end inside the texture gets a flange, an end on another run tees into it (the branch drawn at most 0.85× the
  pipe it joins, and stopped on that pipe's near flank: equal cylinders meeting at the axis show a sharp V). _Random_
  (tileable) — horizontal runs spanning the width (some jogging up or down and back), vertical runs spanning the
  height in front of them, or teeing between two horizontal runs next to each other at that x (at the run's actual
  height there, clear of its jogs' elbows); every run spans exactly one period, so the layout tiles. Drawn runs
  tile too on a tileable project when they cross the edges where their continuation should appear.
- **Crowded and dense layouts**: Horizontal / Vertical runs go to 64. A run that finds no clear band (after 40 tries)
  is no longer dropped: it lies over the runs it overlaps, its axis at their top, and the verticals stand in front of
  the highest horizontal. **Density** (0..1) then stacks layers of straight runs in front — horizontal, vertical,
  horizontal … each resting on everything behind it, its runs apart from one another, each where it covers the most
  bare wall (`Coverage`, a ≤ 256-cell grid; one candidate always on a bare cell) — until that share of the bare wall
  is covered (1 = none left; at most 96 runs). A stack taller than 4 × the radius is scaled to fit the value range
  (the header carries its height) instead of having its front pipes clipped flat; one that fits keeps the default,
  so ordinary layouts render as before. Projects whose run counts did not fit their texture now show the runs that
  used to be dropped.
- **CPU → GPU**: runs become primitives — straight lengths, filleted elbows (arcs; bend radius in pipe radii,
  limited to half the adjoining lengths), collars (couplings at an even spacing, elbow ends, tees) and bolted
  flanges (two plates, a ridge of bolt heads) — copied across the edges when tiling, and packed into an RGBA8 texture
  (16-bit fixed point) through the generator data hook (FR8.10). The shader keeps the highest surface per pixel.
- **Outputs**: Surface height (1 = 4 × the pipe radius), Coverage (writes the pipes' outline to its mask, Shape by
  default, so later layers can be limited to the pipes), Tubes only (the outline less the fittings — glass tubes, metal collars),
  Fittings, Underside (0 on top → 1 underneath: rust, grime), Facing the light (across each pipe, 1 towards the
  top-left → 0 away, continuous around elbows: reflection bands), Liquid (1 below the run's liquid surface).
- **Liquid settles under gravity** (`runLevel`): one level surface per run, set by its lowest horizontal length
  filled to Liquid level of its bore; everything in the run below it is liquid — elbows and drops included — and
  anything higher is empty (a fill that followed each cross-section curled round the bends). A branch shares the
  surface of the pipes it tees into (the lowest); a run without horizontal lengths fills from its bottom up, and a
  spanning vertical on a tiling texture is full or empty (a level line would break at the seam).
- The craft rule capping relief at 2.5 (minimal relief) exempts pipework: its height is its shape.

## Glass filter (`layers/filters/glass.ts`)

Glass over what is already painted, inside the Shape mask (or the mask it writes): the background sampled further out
along the surface slope (from the height: magnified in the middle, squeezed at the rims), carried mostly as emission (transmitted light
is not shaded by the glass surface), tinted more towards the rims (a longer path through the glass), Fresnel-darkened
rims, an inner glint on the far side from the light, and low roughness / high specular for the highlights.

## Pipes lump

Pipework in both stacks: true-scale relief (`RecipeContext.depth` = the project's heightDepth), per-pipe colour,
weathering, grime underneath, and trails running down the wall from the pipes' lower edges (relief-driven drips,
limited to outside the pipes). Switches cast shadows on.

- **Finish**: rusty iron, painted (Colour; chips), copper (verdigris), galvanised steel, chrome, plastic (PVC) and
  glass. Each sets colours, roughness, specular and its weathering colour and roughness. **Shine** moves roughness and
  specular together from the finish's usual sheen to dull or polished — the gloss highlight along each pipe.
- Chrome, steel and copper mirror their surroundings with bands across the pipe (Facing the light: sky, a dark band
  past the middle, the floor's glow at the far edge) — chrome in full, the others as a hint.
- **Glass**: the tubes (fittings excluded) get the Glass filter; collars are steel; an optional liquid (level, colour,
  glow) is painted after the refraction, so it fills the tube rather than being squeezed into a thread; its surface
  is level (see Liquid above).

## Peeling paint lump

An overlay for any substrate (tiles, plates, concrete): one fBm decides where paint is left (Paint left,
Chip size, Raggedness, Vertical streaking); the same noise colours the paint — darker near a chip, lighter inside —
over what the chips expose (Beneath: rust → bare metal, primer or plaster). A thin relief step at chip edges (lit
rim, shadow), large mottle, grain, rust streaks and grime in the substrate's creases.

## Lessons

- The colour fit wrecks these looks (teal paint → black and white): seed colours by hand.
- Paint and rust need more variety than one noise gives to approach a photograph (layered rust, seams, edge wear).
