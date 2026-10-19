import { defaultParams, sanitizeParams, type ParamValues } from '@/core/params';
import type { PostFilter } from '@/core/project';
import { newId } from '@/core/ids';
import type { PostDef } from './types';

const defs = new Map<string, PostDef>();

export function registerPost(def: PostDef): void {
	defs.set(def.type, def);
}

export function getPostDef(type: string): PostDef | undefined {
	return defs.get(type);
}

export function allPostDefs(): PostDef[] {
	return [...defs.values()];
}

export function createPostFilter(type: string, overrides: ParamValues = {}): PostFilter {
	const def = defs.get(type);
	if (!def) throw new Error(`Unknown post filter: ${type}`);
	return { id: newId('pf'), type, enabled: true, params: { ...defaultParams(def.params), ...overrides } };
}

export function sanitizePostFilter(f: PostFilter): PostFilter {
	const def = defs.get(f.type);
	return def ? { ...f, params: sanitizeParams(def.params, f.params) } : f;
}
