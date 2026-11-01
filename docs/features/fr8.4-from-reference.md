# FR8.4 — Start from a reference: Suggest

**Status:** done — Match workspace button _Suggest_. _Variations_ (random perturbations to pick by eye) was
removed: little used, and its name was close to project variants (FR10).

## Goal

Put a person's eye at the point the metric gets wrong most: choosing the family.

## Design (`src/ui/panels/MatchWorkspace.vue`)

- **Suggest**: the reference (at most 128 px on the long side) is analysed; every available template is built for
  it (palette, periods), colour-fitted (FR8.2) and scored with the texture-aware metric (FR8.1); the gallery fills in
  ranked as it goes. Optional palette snap (None / Quake / Doom). Clicking a card loads it (undoable) — then
  _Optimise_ (with the FR6.3 stop criteria).
- The Match workspace's matcher carries the texture term when the preset uses it.

## Checklist

- [x] Suggest gallery (progressive, ranked, palette option)
