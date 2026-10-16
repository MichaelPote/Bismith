// Icon + category-hue lookup for outliner rows and add menus (Cinderforge category hues, stroke only). Icons are
// Tabler components (@tabler/icons-vue).

import type { Component } from 'vue'
import {
  IconAdjustmentsHorizontal,
  IconAxe,
  IconBadge,
  IconBlur,
  IconBorderCorners,
  IconBorderOuter,
  IconBoxPadding,
  IconBrush,
  IconBuildingFactory2,
  IconBulb,
  IconCircle,
  IconCircles,
  IconCloud,
  IconContrast,
  IconCpu,
  IconDropletHalf2,
  IconFilter,
  IconFlare,
  IconFlipVertical,
  IconFrame,
  IconGlass,
  IconGrain,
  IconGrid3x3,
  IconGridDots,
  IconGridPattern,
  IconHammer,
  IconHexagon,
  IconHexagons,
  IconLayoutBoard,
  IconLayoutGrid,
  IconLetterA,
  IconLine,
  IconLineDashed,
  IconMountain,
  IconPlant2,
  IconPaint,
  IconPalette,
  IconPipeline,
  IconPlus,
  IconPolygon,
  IconRipple,
  IconRoute,
  IconScissors,
  IconShadow,
  IconSpiral,
  IconSquare,
  IconSquareRotated,
  IconSquaresDiagonal,
  IconTexture,
  IconTriangleSquareCircle,
  IconTypography,
  IconVectorBezier2,
  IconVectorSpline,
  IconWall,
  IconWaveSawTool,
  IconWaveSine,
  IconWood,
} from '@tabler/icons-vue'
import type { LayerCategory } from '@/layers/types'
import { getLayerDef } from '@/layers/registry'

export const CATEGORY_HUE: Record<LayerCategory, string> = {
  noise: 'var(--cat-rose)',
  shape: 'var(--cat-stone)',
  pattern: 'var(--cat-sky)',
  filter: 'var(--cat-teal)',
  adjust: 'var(--cat-slate)',
}

const TYPE_ICON: Record<string, Component> = {
  rect: IconSquare,
  ellipse: IconCircle,
  polygon: IconPolygon,
  line: IconLine,
  curve: IconVectorSpline,
  cross: IconPlus,
  path: IconVectorBezier2,
  stamp: IconBadge,
  label: IconTypography,
  glyph: IconLetterA,
  cable: IconSpiral,
  bricks: IconWall,
  setts: IconWall,
  clouds: IconCloud,
  voronoi: IconHexagons,
  hex: IconHexagon,
  stripes: IconSquaresDiagonal,
  bands: IconSquaresDiagonal,
  wood: IconWood,
  marble: IconTexture,
  drips: IconDropletHalf2,
  chips: IconAxe,
  rock: IconMountain,
  stone_blocks: IconWall,
  grass: IconPlant2,
  scratches: IconWaveSawTool,
  hammered: IconHammer,
  pipes: IconPipeline,
  pipework: IconPipeline,
  traces: IconRoute,
  tabs: IconBorderCorners,
  vents: IconGridPattern,
  greebles: IconLayoutBoard,
  trim: IconFrame,
  treadplate: IconGridDots,
  scales: IconCircles,
  truchet: IconWaveSine,
  weave: IconTexture,
  tessellation: IconTriangleSquareCircle,
  rosette: IconFlare,
  caustics: IconRipple,
  causticlight: IconRipple,
  gradient: IconContrast,
  grid: IconGrid3x3,
  checker: IconLayoutGrid,
  blur: IconBlur,
  bevel: IconBorderOuter,
  etch: IconLineDashed,
  cavity: IconShadow,
  warp: IconWaveSine,
  symmetry: IconFlipVertical,
  glass: IconGlass,
  levels: IconMountain,
  hsv: IconPalette,
  heightFromDiffuse: IconContrast,
}

const CATEGORY_ICON: Record<LayerCategory, Component> = {
  noise: IconGrain,
  shape: IconSquare,
  pattern: IconLayoutGrid,
  filter: IconFilter,
  adjust: IconAdjustmentsHorizontal,
}

export function layerIcon(type: string): Component {
  const def = getLayerDef(type)
  return TYPE_ICON[type] ?? (def ? CATEGORY_ICON[def.category] : IconSquareRotated)
}

/** Smart-material recipes, by recipe id. */
const RECIPE_ICON: Record<string, Component> = {
  'dressed-stone': IconWall,
  cobblestones: IconCircles,
  liquid: IconRipple,
  wood: IconWood,
  marble: IconTexture,
  rock: IconMountain,
  'hammered-metal': IconHammer,
  'brushed-metal': IconBrush,
  stains: IconDropletHalf2,
  stripes: IconSquaresDiagonal,
  tiles: IconLayoutGrid,
  concrete: IconBuildingFactory2,
  grate: IconGridPattern,
  'metal-plate': IconBoxPadding,
  'light-panel': IconBulb,
  circuit: IconCpu,
  pipes: IconPipeline,
  paint: IconPaint,
  cutout: IconScissors,
}

export function recipeIcon(id: string): Component {
  return RECIPE_ICON[id] ?? IconSquareRotated
}

export function layerHue(type: string): string {
  const def = getLayerDef(type)
  return def ? CATEGORY_HUE[def.category] : 'var(--text-lo)'
}

export const LIGHT_HUE = 'var(--cat-gold)'
export const POST_HUE = 'var(--cat-violet)'
