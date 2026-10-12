# FR2.3 — Shape layers (SDF)

**Status:** done (v1)

## Goal
"Straight lines, curves, boxes, rectangles, circles, etc." as exact 2D signed-distance primitives that can be
combined with SDF operators and bevelled analytically — the backbone of skeuomorphic UI surfaces.

## Plan
- `src/layers/glsl/sdf.ts` — primitives: rounded rectangle (per-corner radius), circle / ellipse, ring,
  regular polygon / star, line segment (round / flat caps), quadratic Bézier curve, cross; operators:
  union, subtract, intersect, smooth variants, onion (outline), round.
- Shape layer params: position (0..1, y down), size in px or **inset** margins in px (rect), rotation,
  corner radius, outline thickness (onion), anti-alias toggle (off = hard pixel edges), **repeat** grid
  (count X/Y, per-instance random → `rnd`) for rivets / bolts / tiles.
- Common SDF params on every SDF generator: combine operator + smoothness, bevel width (px), profile.
- Wrap-around evaluation on tileable projects (minimum over neighbouring periods).

## Checklist
- [x] SDF primitive library
- [x] SDF operators incl. smooth variants + onion
- [x] Rectangle (centred size / inset margins, rounded corners) — also chamfered corners and per-corner selection (Cinderforge notch)
- [x] Circle / ellipse / ring
- [x] Polygon / star
- [x] Line segment
- [x] Bézier curve
- [x] Repeat grid with per-instance random — plus row stagger, position/rotation/scale jitter, drop-out
- [x] Bevel profiles from combined distance
- [x] Wrap-around on tileable projects
