# FR8.13 — Named masks and cut-outs

**Status:** superseded by [FR8.23](fr8.23-masks.md) — the Shape Mask and these four numbered masks became one system
of named masks that follow the stack (no pre-pass), and Crevices & high spots became Mask area. Kept as the record of
the original design.

## Naming

In the UI the shape register is the **Shape Mask** (code keeps `register`, `sdf_op`, `m_clip`), the first section of the
Mask card — _Use shape mask_ ticked (`sm_on`) the layer writes its shape, unticked it leaves the shape mask alone (formerly the
"Ignore register" operator; old projects migrate on load and on `createLayer`, `migrateParams`). _Mode_: Normal
(was New shape), Union, Subtract, Intersection and their smooth variants; _Mask › Shape mask › Clip to_:
inside / outside. Named masks are the four numbered masks below; the viewport has _Shape Mask_ (`0`) and _Named
masks_ (`M`) views.

## Goal

Mask layers individually — e.g. cut a hole in a metal wall with a circuit board showing through behind it. The shape
register (one signed distance, rewritten by every shape layer) can't hold a hole across whole materials.

## Design

- **State**: a fourth MRT attachment (`tMasks`, RGBA = masks 1–4) rides along with albedo · surface · emissive. MRT
  passes that don't write it get a pass-through automatically (`withMaskPassThrough` wraps their `main`), so
  filters need no changes; the clear zeroes it, the relief → paint reset keeps it.
- **Writing** (generators, Mask group): _Write to mask_ 1–4 with _Replace / Add (union) / Subtract / Intersect_;
  the value written is the layer's final coverage (after its own clips). Typically a shape with every output off.
- **Order-independent**: before the evaluation proper, every enabled layer that writes a mask runs, in stack order,
  on a scratch evaluation over the base (mask writers see no earlier shapes or heights); the evaluation then starts
  from the masks it left, and writers don't write again. So a mask applies wherever its writer sits — a Cut-out
  added after the materials still cuts them.
- **Using** (generators and filters, Mask group): _Masked by_ 1–4, _Outside the mask_ to cut a hole. Single-pass
  filters blend their result by the mask inline; multi-pass filters (blur, cavity, bevel …) run on the whole state
  and are blended back against a snapshot taken before them.
- **As an edge**: Bevel and Etch take _Source › Mask 1–4_ — the mask above _Threshold_, turned into a distance by
  jump flood like the channel sources (FR2.5), so a mask's outline can be bevelled or grooved.
- **Materials**: a material's Mask card (`SmartMaterial.mask`, `setMaterialMask`) clips every member; kept on the
  material, so members a macro rebuilds keep it. Cutting a hole: the material in front _outside_ the mask, the one
  behind _inside_ it — a material painted over another replaces colour, not its glow or relief.
- **Cut-out lump**: the opening (rectangle with corner radius, or ellipse) writes the mask; a bevelled recess step
  (lowered inside — add the cut-out after the materials it cuts) and an optional raised frame ring with its own
  colour. Switches cast shadows on.
- **Masks view** (`M`): mask 1 red, 2 green, 3 blue, 4 amber.
- **Feather** (_Write to mask › Feather_, px): a shape layer writes a soft ramp that wide across its outline
  (`clamp(0.5 − d / feather)` on its signed distance) instead of its crisp coverage; noise-type layers soften with
  _Shaping › Cutoff softness_. Only the mask is soft: the layer's own drawing stays crisp.
- **Crevices & high spots** (`surfacemask`): a mask read from the surface the layers before it built — the height
  against a centre-weighted average of three rings of samples within _Radius_: crevices (lower than around them),
  high spots (higher), both, or slopes; _Depth_ (or _Full at slope_) sets a full mask, _Level_ / _Softness_ shape it.
  Writes Mask 1 by default with its other outputs off — or paint with it directly (grime in joints, wear on edges).
- **Layers that read earlier state** (`LayerDef.readsState`: Crevices & high spots, Drips) write their masks where
  they sit, not in the pre-pass (which only sees the base): only the layers after them see those masks.
