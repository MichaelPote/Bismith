# FR8.13 — Named masks and cut-outs

**Status:** done — four mask channels; per-layer, per-filter and per-material clipping; Cut-out lump; Masks view

## Naming
In the UI the shape register is the **Shape Mask** (code keeps `register`, `sdf_op`, `m_clip`): a toggle group like
Diffuse — ticked (`sm_on`) the layer writes its shape, unticked it leaves the shape mask alone (formerly the
"Ignore register" operator; old projects migrate on load and on `createLayer`, `migrateParams`). *Mode*: Normal
(was New shape), Union, Subtract, Intersection and their smooth variants; *Mask › Clip to shape mask*:
inside / outside. Named masks are the four numbered masks below; the viewport has *Shape Mask* (`0`) and *Named
masks* (`M`) views.

## Goal
Mask layers individually — e.g. cut a hole in a metal wall with a circuit board showing through behind it. The shape
register (one signed distance, rewritten by every shape layer) can't hold a hole across whole materials.

## Design
- **State**: a fourth MRT attachment (`tMasks`, RGBA = masks 1–4) rides along with albedo · surface · emissive. MRT
  passes that don't write it get a pass-through automatically (`withMaskPassThrough` wraps their `main`), so
  filters need no changes; the clear zeroes it, the relief → paint reset keeps it.
- **Writing** (generators, Mask group): *Write to mask* 1–4 with *Replace / Add (union) / Subtract / Intersect*;
  the value written is the layer's final coverage (after its own clips). Typically a shape with every output off.
- **Order-independent**: before the evaluation proper, every enabled layer that writes a mask runs, in stack order,
  on a scratch evaluation over the base (mask writers see no earlier shapes or heights); the evaluation then starts
  from the masks it left, and writers don't write again. So a mask applies wherever its writer sits — a Cut-out
  added after the materials still cuts them.
- **Using** (generators and filters, Mask group): *Masked by* 1–4, *Outside the mask* to cut a hole. Single-pass
  filters blend their result by the mask inline; multi-pass filters (blur, cavity, bevel …) run on the whole state
  and are blended back against a snapshot taken before them.
- **Materials**: a material's Mask card (`SmartMaterial.mask`, `setMaterialMask`) clips every member; kept on the
  material, so members a macro rebuilds keep it. Cutting a hole: the material in front *outside* the mask, the one
  behind *inside* it — a material painted over another replaces colour, not its glow or relief.
- **Cut-out lump**: the opening (rectangle with corner radius, or ellipse) writes the mask; a bevelled recess step
  (lowered inside — add the cut-out after the materials it cuts) and an optional raised frame ring with its own
  colour. Switches cast shadows on.
- **Masks view** (`M`): mask 1 red, 2 green, 3 blue, 4 amber.
