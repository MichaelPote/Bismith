import type { LayerDef } from '../types'
import { noiseLayer } from './noise'
import { SHAPE_LAYERS } from './shapes'
import { PATTERN_LAYERS, cloudsLayer } from './patterns'
import { ORGANIC_LAYERS } from './organic'
import { GEOMETRIC_LAYERS } from './geometric'
import { MOTIF_LAYERS } from './motif'
import { GREEBLE_LAYERS } from './greeble'
import { STAMP_LAYERS } from './stamp'
import { cableLayer } from './cable'
import { dripsLayer } from './drips'
import { hammeredLayer } from './hammered'
import { tabsLayer } from './tabs'
import { tracesLayer } from './traces'
import { causticLightLayer } from './causticLight'
import { settsLayer } from './setts'
import { pipeworkLayer } from './pipes'
import { surfaceMaskLayer } from './surfaceMask'
import { chipsLayer } from './chips'
import { rockLayer } from './rock'
import { grassLayer } from './grass'

/** Every generator layer type, in add-menu order within each category. */
export const GENERATORS: LayerDef[] = [
  noiseLayer,
  cloudsLayer,
  ...SHAPE_LAYERS,
  ...PATTERN_LAYERS,
  ...ORGANIC_LAYERS,
  ...GEOMETRIC_LAYERS,
  ...MOTIF_LAYERS,
  ...GREEBLE_LAYERS,
  ...STAMP_LAYERS,
  cableLayer,
  dripsLayer,
  hammeredLayer,
  tabsLayer,
  tracesLayer,
  causticLightLayer,
  settsLayer,
  pipeworkLayer,
  surfaceMaskLayer,
  chipsLayer,
  rockLayer,
  grassLayer,
]
