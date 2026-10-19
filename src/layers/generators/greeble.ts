// Tech / greeble generator family (FR7.2d, docs/features/fr7.2d-greeble-generators.md): greebles (machine panels),
// vents & grilles, pipes & conduits, trim strips.

import type { LayerDef } from '../types';
import { greeblesLayer } from './greebles';
import { pipesLayer, ventsLayer } from './greebleVents';
import { trimLayer } from './greebleTrim';

export { greeblesLayer, ventsLayer, pipesLayer, trimLayer };

export const GREEBLE_LAYERS: LayerDef[] = [greeblesLayer, ventsLayer, pipesLayer, trimLayer];
