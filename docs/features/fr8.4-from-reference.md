# FR8.4 — Start from a reference: Suggest and Variations

**Status:** done — Match workspace buttons _Suggest_ and _Variations_

## Goal

Put a person's eye at the two points the metric gets wrong: choosing the family, and choosing between close
alternatives.

## Design (`src/ui/panels/MatchWorkspace.vue`, `src/match/variations.ts`)

- **Suggest**: the reference (at most 128 px on the long side) is analysed; every available template is built for
  it (palette, periods), colour-fitted (FR8.2) and scored with the texture-aware metric (FR8.1); the gallery fills in
  ranked as it goes. Optional palette snap (None / Quake / Doom). Clicking a card loads it (undoable) — then
  _Optimise_ (with the FR6.3 stop criteria) or _Variations_.
- **Variations**: eight perturbations around the current project in a 3×3 grid, the current one in the centre;
  each moves a few tunable params by _Spread_ of their range (colours a third as far), sometimes re-rolls a seed;
  linked copies move together. Scored when a reference is loaded. Clicking one
  takes it and varies again (interactive evolution); the centre or ✕ closes.
- The Match workspace's matcher carries the texture term when the preset uses it.

## Checklist

- [x] Suggest gallery (progressive, ranked, palette option)
- [x] Variations grid with spread, again, pick-and-repeat (`variations.test.ts`)
- [ ] Variations of a smart material's macros (instead of raw params)
