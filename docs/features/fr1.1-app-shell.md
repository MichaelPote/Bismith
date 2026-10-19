# FR1.1 — App shell & Cinderforge theme

**Status:** done (v1)

## Goal

A Vue 3 + Vite single-page app with the Cinderforge _Blender-tempered_ editor layout, so every later feature
has a home: top bar, outliner, viewport, properties panel, status bar.

## Plan

- Replace the React/Tailwind starter with Vue 3, Pinia, Three.js, TypeScript (strict), vue-tsc, Vitest, oxlint.
- `src/styles/tokens.css` — Cinderforge tokens as CSS custom properties (ground, lines, text, ember ramp,
  category hues, spacing, radii, fonts); `base.css` for resets, focus ring (1px Ember 400), scrollbars.
- Fonts bundled with `@fontsource` (IBM Plex Sans 400/500/700, IBM Plex Mono 400/500, Cormorant Garamond 500/600).
- Layout components: `TopBar` (logo diamond + serif wordmark, menus, workspace tabs with Underlight bar,
  file name, heat-button primary action), `Outliner` (left), `Viewport` (centre), `Properties` (right),
  `StatusBar` (bottom, mono hints).
- Reusable controls in `src/ui/components/`: `NumberField` (Blender-style scrub field with fill bar, arrows,
  click-to-type), `ColorField`, `SelectField`, `CheckField`, `GradientField`, `PanelCard` (collapsible),
  `IconButton` (square, Halo when active), `Icon` (inline stroke SVGs from the Cinderforge icon palette).
- Menus as simple dropdown popovers; keyboard focus visible; real `<button>`/`<input>` everywhere.

## Checklist

- [x] Vue/Vite/TS scaffold replaces React starter
- [x] Cinderforge tokens + base styles
- [x] Fonts bundled
- [x] Editor layout (top bar, outliner, viewport, properties, status bar)
- [x] NumberField (scrub, type, arrows, soft/hard limits)
- [x] ColorField, SelectField, CheckField, PanelCard, IconButton, Icon set
- [x] GradientField
- [x] Dropdown menus (File / Edit / View / Help)
- [x] Resizable side panels
