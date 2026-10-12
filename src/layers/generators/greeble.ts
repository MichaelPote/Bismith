// Tech / greeble generator family (FR7.2d, docs/features/fr7.2d-greeble-generators.md): machine panels,
// vents & grilles, pipes & conduits, trim strips.

import type { LayerDef } from '../types'
import { panelsLayer } from './greeblePanels'
import { pipesLayer, ventsLayer } from './greebleVents'
import { trimLayer } from './greebleTrim'

export { panelsLayer, ventsLayer, pipesLayer, trimLayer }

export const GREEBLE_LAYERS: LayerDef[] = [panelsLayer, ventsLayer, pipesLayer, trimLayer]
