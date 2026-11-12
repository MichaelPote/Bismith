// The Bismith Gallery (a separate site, bismith-gallery; VITE_GALLERY_URL, default https://gallery.bismith.dev): publish
// the open project with a render per variant, update or remove it later, and fetch a published project to open.
//
// Nobody signs in. The gallery tells visitors apart by a browser fingerprint (fingerprint.ts) and gives the author of
// each project an edit key, returned once when it is published and kept here, in this browser's local storage.

import { visitorFingerprint } from './fingerprint';

export const GALLERY_URL = (
	(import.meta.env.VITE_GALLERY_URL as string | undefined) || 'https://gallery.bismith.dev'
).replace(/\/+$/, '');

export { GALLERY_ID } from './ids';

export const MAX_NAME = 80;
export const MAX_DESCRIPTION = 2000;
export const MAX_AUTHOR = 40;
/** Renders per project the gallery takes (one per variant). */
export const MAX_VARIANTS = 16;

export function projectPageUrl(id: string): string {
	return `${GALLERY_URL}/p/${id}`;
}

export class GalleryError extends Error {
	constructor(
		readonly status: number,
		readonly code: string,
		message: string,
		/** For `duplicate`: the gallery project that already has this layer stack. */
		readonly id?: string
	) {
		super(message);
	}
}

async function call<T>(path: string, init: RequestInit & { key?: string } = {}): Promise<T> {
	const headers = new Headers(init.headers);
	headers.set('X-Bismith-Visitor', await visitorFingerprint());
	if (init.key) headers.set('Authorization', `Bearer ${init.key}`);
	let res: Response;
	try {
		res = await fetch(`${GALLERY_URL}${path}`, { ...init, headers });
	} catch {
		throw new GalleryError(0, 'offline', 'The gallery could not be reached. Check your connection and try again.');
	}
	if (!res.ok) {
		const body = (await res.json().catch(() => null)) as { error?: string; message?: string; id?: string } | null;
		throw new GalleryError(
			res.status,
			body?.error ?? 'server',
			body?.message ?? `The gallery answered ${res.status}.`,
			body?.id
		);
	}
	return (await res.json()) as T;
}

// ------------------------------------------------------------------------------------------------- edit keys

const KEYS = 'bismith:gallery-keys';
const AUTHOR = 'bismith:gallery-author';

function readKeys(): Record<string, string> {
	try {
		const v = JSON.parse(localStorage.getItem(KEYS) ?? '{}');
		return v && typeof v === 'object' ? v : {};
	} catch {
		return {};
	}
}

/** The edit key this browser holds for gallery project `id`, if any. */
export function editKey(id: string | undefined): string | undefined {
	return id ? readKeys()[id] : undefined;
}

function setKey(id: string, key: string | null): void {
	const keys = readKeys();
	if (key) keys[id] = key;
	else delete keys[id];
	try {
		localStorage.setItem(KEYS, JSON.stringify(keys));
	} catch {
		/* storage full or off: the key is lost with the page */
	}
}

/** The author name used last time, offered again. */
export function lastAuthor(): string {
	try {
		return localStorage.getItem(AUTHOR) ?? '';
	} catch {
		return '';
	}
}

function rememberAuthor(name: string): void {
	try {
		if (name) localStorage.setItem(AUTHOR, name);
		else localStorage.removeItem(AUTHOR);
	} catch {
		/* not kept */
	}
}

// --------------------------------------------------------------------------------------------------- calls

/** One variant's render for the gallery: up to 1024 px, and a thumbnail up to 512 px. */
export interface GalleryRender {
	name: string;
	image: Blob;
	thumb: Blob;
}

export interface Submission {
	/** The project file (JSON). */
	project: string;
	name: string;
	description: string;
	author: string;
	/** Cover first. */
	renders: GalleryRender[];
}

export interface Published {
	id: string;
	url: string;
	version: number;
}

function form(s: Submission): FormData {
	const f = new FormData();
	f.set('project', new Blob([s.project], { type: 'application/json' }), 'project.bismith.json');
	f.set('name', s.name);
	f.set('description', s.description);
	f.set('author', s.author);
	s.renders.forEach((r, n) => {
		const ext = (b: Blob) => (b.type === 'image/webp' ? 'webp' : b.type === 'image/png' ? 'png' : 'jpg');
		f.append('image', r.image, `render-${n}.${ext(r.image)}`);
		f.append('thumb', r.thumb, `thumb-${n}.${ext(r.thumb)}`);
		f.append('variant', r.name);
	});
	return f;
}

/** Publish as a new gallery project; its edit key is kept in this browser. */
export async function publish(s: Submission): Promise<Published> {
	const r = await call<Published & { key: string }>('/api/projects', { method: 'POST', body: form(s) });
	setKey(r.id, r.key);
	rememberAuthor(s.author);
	return { id: r.id, url: r.url, version: r.version };
}

/**
 * Replace gallery project `id` (file, renders, text) with this browser's edit key. A key the gallery no longer knows
 * (the project was removed) is forgotten.
 */
export async function update(id: string, s: Submission): Promise<Published> {
	const key = editKey(id);
	if (!key) throw new GalleryError(401, 'no_key', 'This browser doesn’t hold the edit key for that project.');
	try {
		const r = await call<Published>(`/api/projects/${id}`, { method: 'PUT', body: form(s), key });
		rememberAuthor(s.author);
		return r;
	} catch (e) {
		if (e instanceof GalleryError && (e.status === 404 || e.status === 403)) setKey(id, null);
		throw e;
	}
}

/** Remove gallery project `id` with this browser's edit key. */
export async function remove(id: string): Promise<void> {
	const key = editKey(id);
	if (!key) throw new GalleryError(401, 'no_key', 'This browser doesn’t hold the edit key for that project.');
	try {
		await call(`/api/projects/${id}`, { method: 'DELETE', key });
	} catch (e) {
		if (!(e instanceof GalleryError && e.status === 404)) throw e;
	}
	setKey(id, null);
}

/** How many projects this browser has in the gallery, and how many it may. */
export function quota(): Promise<{ published: number; limit: number }> {
	return call('/api/me');
}

/** A published project's file, to open. */
export async function fetchProjectFile(id: string): Promise<string> {
	let res: Response;
	try {
		res = await fetch(`${GALLERY_URL}/api/projects/${id}/file`);
	} catch {
		throw new GalleryError(0, 'offline', 'The gallery could not be reached.');
	}
	if (res.status === 404) throw new GalleryError(404, 'not_found', 'That project is no longer in the gallery.');
	if (!res.ok) throw new GalleryError(res.status, 'server', `The gallery answered ${res.status}.`);
	return res.text();
}
