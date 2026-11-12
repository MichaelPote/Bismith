// Geometric generator family (docs/features/fr7.2b-geometric-generators.md): tiles (lattices and checkerboards), tread plate,
// woven strands and tech-wall bands. Shared GLSL lives in geometricCommon.ts.

import type { LayerDef } from '../types';
import { tilesLayer } from './geometricTiles';
import { treadplateLayer, weaveLayer } from './geometricSurface';
import { bandsLayer } from './geometricBands';
import { panellingLayer } from './panelling';
import { strapworkLayer } from './strapwork';
import { carvingLayer } from './carving';

export { tilesLayer, treadplateLayer, weaveLayer, bandsLayer, panellingLayer, strapworkLayer, carvingLayer };

/** Geometric pattern layers, in add-menu order. */
export const GEOMETRIC_LAYERS: LayerDef[] = [
	tilesLayer,
	treadplateLayer,
	weaveLayer,
	bandsLayer,
	panellingLayer,
	strapworkLayer,
	carvingLayer
];
