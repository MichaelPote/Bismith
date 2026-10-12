// Icon + category-hue lookup for outliner rows and add menus (Cinderforge category hues, stroke only).

import type { LayerCategory } from '@/layers/types'
import { getLayerDef } from '@/layers/registry'

export const CATEGORY_HUE: Record<LayerCategory, string> = {
  noise: 'var(--cat-rose)',
  shape: 'var(--cat-stone)',
  pattern: 'var(--cat-sky)',
  filter: 'var(--cat-teal)',
  adjust: 'var(--cat-slate)',
}

const TYPE_ICON: Record<string, string> = {
  rect: 'shape',
  ellipse: 'circle',
  polygon: 'polygon',
  line: 'line',
  curve: 'curve',
  cross: 'cross',
  path: 'path',
  stamp: 'stamp',
  label: 'label',
  glyph: 'glyph',
  cable: 'cable',
  bricks: 'bricks',
  setts: 'bricks',
  clouds: 'clouds',
  voronoi: 'voronoi',
  hex: 'hex',
  stripes: 'stripes',
  bands: 'stripes',
  wood: 'wood',
  marble: 'marble',
  drips: 'drips',
  scratches: 'scratches',
  hammered: 'hammered',
  pipes: 'pipes',
  pipework: 'pipes',
  traces: 'traces',
  tabs: 'tabs',
  vents: 'vents',
  panels: 'panels',
  trim: 'trim',
  treadplate: 'treadplate',
  scales: 'scales',
  truchet: 'wave',
  weave: 'marble',
  tessellation: 'tessellation',
  rosette: 'rosette',
  caustics: 'caustics',
  causticlight: 'caustics',
  gradient: 'gradient',
  grid: 'grid-3',
  checker: 'tiles',
  blur: 'blur',
  bevel: 'bevel',
  etch: 'etch',
  cavity: 'cavity',
  warp: 'wave',
  symmetry: 'symmetry',
  glass: 'glass',
  levels: 'height',
  hsv: 'palette',
  heightFromDiffuse: 'gradient',
}

const CATEGORY_ICON: Record<LayerCategory, string> = {
  noise: 'noise',
  shape: 'shape',
  pattern: 'pattern',
  filter: 'filter',
  adjust: 'adjust',
}

export function layerIcon(type: string): string {
  const def = getLayerDef(type)
  return TYPE_ICON[type] ?? (def ? CATEGORY_ICON[def.category] : 'diamond')
}

export function layerHue(type: string): string {
  const def = getLayerDef(type)
  return def ? CATEGORY_HUE[def.category] : 'var(--text-lo)'
}

export const LIGHT_HUE = 'var(--cat-gold)'
export const POST_HUE = 'var(--cat-violet)'
