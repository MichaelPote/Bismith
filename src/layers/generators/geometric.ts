// Geometric generator family (docs/features/fr7.2b-geometric-generators.md): tiles (lattices and checkerboards), tread plate,
// woven strands and tech-wall bands. Shared GLSL lives in geometricCommon.ts.

import type { LayerDef } from '../types';
import { tilesLayer } from './geometricTiles';
import { treadplateLayer, weaveLayer } from './geometricSurface';
import { bandsLayer } from './geometricBands';
import { panellingLayer } from './panelling';

export { tilesLayer, treadplateLayer, weaveLayer, bandsLayer, panellingLayer };

/** Geometric pattern layers, in add-menu order. */
export const GEOMETRIC_LAYERS: LayerDef[] = [tilesLayer, treadplateLayer, weaveLayer, bandsLayer, panellingLayer];
