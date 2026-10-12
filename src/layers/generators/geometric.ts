// Geometric generator family (docs/features/fr7.2b-geometric-generators.md): tile lattices, tread plate,
// woven strands and tech-wall bands. Shared GLSL lives in geometricCommon.ts.

import type { LayerDef } from '../types'
import { tessellationLayer } from './geometricTessellation'
import { treadplateLayer, weaveLayer } from './geometricSurface'
import { bandsLayer } from './geometricBands'

export { tessellationLayer, treadplateLayer, weaveLayer, bandsLayer }

/** Geometric pattern layers, in add-menu order. */
export const GEOMETRIC_LAYERS: LayerDef[] = [tessellationLayer, treadplateLayer, weaveLayer, bandsLayer]
