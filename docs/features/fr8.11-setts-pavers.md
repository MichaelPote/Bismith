# FR8.11 — Setts and pavers (fans, rings, bone, plus)

**Status:** done — Tiles lump patterns *Fan setts*, *Ring setts*, *Bone pavers*, *Plus pavers*; tuned against
reference textures of fan cobbles, bone pavers and plus pavers.

## Setts generator (`layers/generators/setts.ts`)
Small paving stones laid in concentric arcs.

- **Fans**: disks of radius R on an offset-row lattice (W apart in a row, rows H apart, alternate rows shifted W/2),
  each row lying on top of the row above it. With R = √(W²/4 + H²) the two disks below a fan pass exactly through its
  centre and hide its lower half, so each fan shows as a scale — a round rim, two arcs meeting at a point — with its
  courses concentric about that point: the classic fan (H = W/2, R = W/√2). (Radius W/2 instead leaves each centre
  uncovered: full rosettes in the middle of every scale.) R is never below the lattice's covering radius, so squat
  rows still fill the plane.
- **Rings**: one rosette per rectangular cell, cut by the cell.
- **Setts**: course k (k = 0 a round centre stone) holds n ≈ 2π r / length setts, each an annular sector — joints of
  even width, setts cut where fans meet (the region's distance joins the sett's). Random course turn (Joint
  stagger) and hand-laid Irregularity (per-sett size, angle and radius). Per sett / course / fan random.
- Whole fans across and an even row count when tiling; Direction turns the frame in 90° steps.

## Tiles lump
- *Fan setts* / *Ring setts*: Tile size = the sett, Fans across, Irregularity; courses = rim radius / sett size.
- *Bone pavers*: the Tessellation *cross* tiles (hex topology in half-offset columns) with plateau 0.6 (wide ends, a
  waist) and step 0.3 (the stepped waist), rows 1.35× tall. Tile size = the paver's width.
- *Plus pavers*: the Tessellation *plus* pentominoes. Tile size = an arm.

Lesson: the colour fit can wash out joints on fine, busy patterns (it matches the histogram, and a uniform mid grey
scores well); seed the sett and joint colours from the reference instead.
