# FR7.6 — Relief stack, specular channel, richer relief

**Status:** done (features); three walls rebuilt with them — the other recreations next. The separate relief stack
was later folded into the one layer list (FR8.14): a relief layer is now one with its colour outputs off.

## Goal

Feedback on the FR7.4 recreations: the height maps were "a few height changes", while the originals have rounded,
rough surfaces that catch the light — glints that make the colour richer, blocks of individual heights, and relief
that fades in and out (one wall's joints are crisp in places and vanish in others). The renderer and the layer model
needed the means to express that.

## Design

- **Relief stack** (`project.relief`, evaluated before `project.layers` = the paint stack). Relief layers shape the
  surface — height, roughness, specular, masks — and never colour it: after the stack the pipeline
  resets albedo, opacity and emission colour to the base (one pass), so even filters there cannot leak colour.
  Height modes compose freely inside it: _Bricks_ then a _Noise_ in **Multiply** mode flattens the bricks wherever
  the noise is low; grain added after the multiply stays everywhere. The paint stack then sees the finished relief —
  height masks, cavity dirt, and the masks it wrote (a paint layer limited to the relief's bricks with _Invert_ paints only
  the mortar, weighted by the same noise that drives the relief). Outliner: Paint above Relief above Base material,
  drag between them; Properties hides colour outputs on relief layers; solo preview indexes the evaluation order
  (`stackOrder()`); the optimiser sees relief layers' params.
- **Specular channel**: per-pixel specular _level_ in the emissive target's alpha (was spare). `base.specular` sets
  it, and every generator has a **Specular** output (source / mode / at 0 / at 1 / opacity, like Roughness); blur can
  blur it. `render.specular` is now a **scale**: F0 = 0.08 × level × scale. Old projects migrate exactly (base level
  0.5, scale = old value / 0.5). Viewport channel view and map export "Specular".
- **Specular tint** (`render.specularTint` 0..1): highlights take the albedo's hue at unit luminance —
  `F0 ·= mix(1, albedo / luma(albedo), tint)` — so a glint is as bright as a white one but enriches the colour.
  Defaults to 1 (FR8.17): white glints read as a clear coat; 0 brings them back.
- **Per-feature height variation** (`h_var`, Height group of every generator): each brick / cell / instance gets
  `amount × (1 − h_var × hash(rnd))` — some barely raised, others bold (hash decorrelated from the colour random).
- **Course height variation** (`row_var`, Bricks): jittered bed joints (≤ 0.45 courses, pixel-snapped, tile-safe).
- **Hand-placed stones** (Bricks): `pos_jitter` (random x/y shift per brick, px) and `rot_jitter` (random tilt, °);
  **negative mortar** grows bricks into each other. Overlapping bricks meet in a crease: inside the union the SDF is
  `max(d1, (d1 − d2) / 2)` (d1, d2 = the two nearest bricks) — exactly `d1` when bricks do not overlap, so existing
  textures are unchanged.
- **Domain warp** (`dw_amount` px, `dw_scale`; Shaping group of every generator): displaces the _whole_ generated
  pattern by smooth noise. Unlike Bricks' wobble (which perturbs each brick's outline independently, so joints get
  wide and narrow), neighbouring features move together: joints wander but keep their width. The warped shape lands
  in the mask the layer writes, so paint layers limited to it follow.
- **Ambient occlusion** (`render.ao` strength, `render.aoRadius` px): a horizon-based pass over the height field
  (16 directions × 8 steps, distance-faded) computed whenever the tracer is configured; surface lighting at the
  primary hit × AO^strength (emission excluded). Works with cast shadows off — creases where blocks touch go dark.
  Viewable as the AO channel and exported as an AO map.

- **Custom bevel curve** (profile _Custom curve_ + `bevel_curve`): a new `curve` param type (up to 8 points on
  [0,1]² that may rise and fall — rims, dishes — shape-preserving cubic Hermite with Fritsch–Carlson tangents
  computed on upload, evaluated by a generated
  `curve_<key>()`), edited in Properties with a small SVG curve editor (drag points, click to add, double-click to
  remove). Shared by every SDF generator and the bevel filter via a `BEVEL_CURVE` define.

## Recipes learned

- Dressed stone — relief stack, in order: **Pillow** (the bricks as flat plateaus) → height-only
  **blur** (≈ ⅓ of a block: a broad pillow without medial-axis creases) → **Edges** (same bricks, custom bevel curve:
  crisp edge, slow rise) → **Chips** (Voronoi _Facets_ — tilted planes per cell — with height **Min**, masked _below_
  a level between the edge zone and the faces, so broad flat cuts nibble the arrises only) → **Block heights** (same
  bricks, flat profile, per-feature variation 1 — added _after_ the chips so the mask stays reliable) → lumps / bumps.
- Stone blocks without tenting: custom bevel curve — steep for the first 10–15 % of the bevel (1–2 px), then a long,
  very gentle rise — instead of a wide smooth/round bevel, whose steady rise peaks in the middle (tent / hipped roof).
- Smooth glints, not sparkles: no pixel-scale height grain (the low key light turns it into pixel noise) — keep the
  pixel texture in colour; drive the specular level from broad lumps; roughness ≈ 0.55.
- Domed blocks without hipped-roof ridges: wide _smooth_ bevel, rounded corners, then a height-only **blur** in the
  relief stack (≈ 2 px).
- Dry-stone walls: thin positive mortar, position jitter ≈ 1.2 px, rotation ≈ 3°, domain warp instead of
  wobble, per-stone height variation; paint = mortar (outside), multi-hue stone noise _under_ a half-strength
  per-stone colour, moss masked to low areas, in-hue speckle; AO 1.
- Joints that fade: carve grooves (bricks inverted, subtract) and multiply by noise, so faces stay flat.

## Checklist

- [x] Relief stack: model, serialisation, pipeline (reset pass), store ops, Outliner sections + cross-stack drag,
      Properties, solo preview, optimiser, tests
- [x] Specular level channel + generator output + blur option + view / export + migration test
- [x] Specular scale + tint
- [x] Per-feature height variation; Bricks course height variation
- [x] Hand-placed stones: position / rotation jitter, negative mortar, crease SDF
- [x] Domain warp on every generator
- [x] Ambient occlusion pass + AO channel / map
- [x] Custom bevel curve: curve param type, GLSL evaluation, curve editor, tests
- [x] Voronoi _Facets_ output (tilted planes per cell) for chipped edges; pillow + chips recipe
- [x] Rebuilt: dressed-stone, dry-stone and fading-joint walls (two rounds of feedback)
- [x] Paint layers may add colour-coupled relief (strict separation regressed the walls — see FR7.7)
- [ ] Re-author the other recreations with relief stacks (rocks, bricks, tek plates, metals first)
