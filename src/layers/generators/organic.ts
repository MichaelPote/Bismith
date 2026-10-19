// Organic bespoke generators (FR7.2a, docs/features/fr7.2a-organic-generators.md): veined marble, liquid
// caustics / lava, wooden planks with grain, overlapping scales, cracks. Shared GLSL helpers live in
// organicShared.ts; the layers are split into organicLiquid.ts, organicWood.ts and organicCracks.ts.

import type { LayerDef } from '../types';
import { causticsLayer, marbleLayer } from './organicLiquid';
import { scalesLayer, woodLayer } from './organicWood';
import { cracksLayer } from './organicCracks';

export const ORGANIC_LAYERS: LayerDef[] = [marbleLayer, causticsLayer, woodLayer, scalesLayer, cracksLayer];
