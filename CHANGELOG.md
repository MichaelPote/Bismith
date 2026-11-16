# Changelog

Notable changes to Bismith, newest first.

## Upcoming changes

- Four new Rock project presets: Basalt plateau, Desert stone, Red rock canyon and Sandstone strata.
- Terms of use: a first visit asks you to agree (once per browser) that Bismith itself may not be sold, while
  everything you make with it is yours to use and sell. Help › About spells out the full licence and lists the
  credits for palettes, fonts and libraries.

## Version 0.1.0

- Bismith, a browser editor for procedural flat-surface textures: stack layers into Diffuse, Height, Roughness,
  Specular, Metalness and Emissive maps, light them with a path tracer and finish them with a post stack.
- Nearly 70 layer types, from noise, shapes and masonry to crystals, weathering, machinery and ornament, plus
  filters such as Bevel, Etch, Cavity, Warp and Glass.
- New Rock generator: layered sheets, facets and rims for natural rock faces, with jagged ledges and big fused
  blocks. The original Rock lives on as Stones.
- Stone blocks generator for rock-faced ashlar walls, with five stone-wall starters.
- Tiles generator: checkerboards and tessellated floors in one place.
- Panelling, Strapwork and Carving generators for carved relief: framed panels, interlaced straps and ornament.
- Grass generator for lawns with real turf relief.
- Ice generator: a refracting sheet over the layers below, with depth colour, subsurface glow, cracks and bubbles.
- Snow generator: snow blankets, rime and icicles hanging from overhangs.
- Crystal and Bismuth generators for faceted gems and stepped, iridescent bismuth crystals.
- Liquid splats you can place by hand, Drips with peeling paint over rust, and Blisters as a layer of their own.
- Wood gained chips and splits, joint variation and a Carved mode for gnarled, deeply carved wood with 3D grain.
- Greebles grew into detailed sci-fi panels: pipe channels, hoses, switch banks, fans, sockets and cable bundles that
  join up cleanly.
- Pipes & conduits plan their jogs so runs never clash.
- Bolts / Rivets: sockets, counterbores, chamfered hex heads and domed heads.
- New Splits filter pulls the layers below apart along their weakest lines, like wood opening along its grain.
- Stamp an image file (PNG, JPEG or WebP) into Diffuse or Height, with an optional worn-away look.
- Repeat any shape, stamp or motif on a grid or around a mask's outline.
- Animated noise and caustic light for water scenes.
- One named-mask system: any layer can write its shape, parts or outputs to a mask (Union, Subtract, Intersection,
  smooth blends, feather), and later layers can be limited to it.
- Mask area finds crevices and high spots at any scale and writes them as masks.
- Groups of layers, with group presets for stone, floors, wood, liquids, metals, pipes and tech.
- Cavity / edge wear, Bevel and Etch with feathered edges, and bevels without steps where edges meet at mitres.
- Metalness on every layer, and HDR sky environments (EXR, HDR, Ultra HDR) for reflections on a floor or a wall.
- Lighting presets: Sunset, Daylight and Night Courtyard, from measured skies.
- Supersampling and resizing the canvas keep a texture's look, since pixel sizes follow the canvas.
- Much faster shader compiles on Windows (some generators from 20 s to under 2 s), with a progress bar while they
  build.
- Smoother editing: no GPU stalls on hover or per edit, and a sharper path tracer with specular anti-aliasing.
- Match workspace fits a project to a reference image, with a smarter optimiser, metrics for local texture and
  laid-out references, and runs that keep going in a background tab or resume after the tab closed.
- Tiling workspace finds what gives a texture's repeat away and fixes it by reseeding and nudging the culprit layers.
- Variants: keep several versions of a project in one file, see what each one changes, and export them together.
- Export dialog: pick the variants and maps (Normal as OpenGL or DirectX) and get one PNG or a zip.
- Publish projects to the Bismith Gallery and open other people's from it.
- New Project wizard with colour schemes and project presets in categories, each with a preview.
- Presets on every card (layers, groups, lights, post filters and ramps), plus presets of your own.
- Shape editor: Line, Polyline and Grab tools, snapping, and moving a whole polygon by its centre.
- Viewport gizmos for the selected layer, a sun gizmo on a sky map, and an area and grid gizmo for layout layers.
- Colour picker in HSV or OKLCH with hex copy and paste, an eyedropper, and per-stop opacity in gradients and ramps.
- Number fields stop at the end of their usual range like a notch, and Ctrl snaps them to steps.
- Every drag is one undo step, for fields and gizmos alike.
- Viewport shows a 5×5 tiled preview, and its readout gives the colour you actually see.
- Project files carry a small preview thumbnail, shown in the wizard.
- Plain, friendly hints on every generator setting, and tooltips explaining Match and Tiling settings.
- New logo, an About dialog, a prompt before leaving with unsaved changes, and dialogs with a tray of game keys.
