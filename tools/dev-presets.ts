// The dev server's end of File ▸ Export as Preset… (src/ui/panels/ExportPresetDialog.vue): writes the open project into
// public/presets/project/<folder>/<file>.json and rebuilds the manifest. `apply: 'serve'`, so a build has none of it.
//   GET  /__dev/presets   the category folders (with the label their presets use) and the files
//   POST /__dev/presets   { folder, file, project, replace }

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { join } from 'node:path';
import type { Plugin } from 'vite';
import { PRESET_DIR, presetFiles, writeManifest } from './presets-manifest';

const ROUTE = '/__dev/presets';
const MAX_BODY = 64 * 1024 * 1024;
/** A folder or file name: nothing that can climb out of the presets folder. */
const NAME = /^[a-z0-9][a-z0-9-]*$/;

function listing() {
	const files = presetFiles()
		.filter((p) => p.startsWith('project/'))
		.map((p) => p.slice('project/'.length));
	const labels = new Map<string, Map<string, number>>();
	for (const f of files) {
		const folder = f.split('/')[0];
		const raw = JSON.parse(readFileSync(join(PRESET_DIR, `project/${f}.json`), 'utf8')) as {
			preset?: { category?: string };
		};
		const counts = labels.get(folder) ?? new Map<string, number>();
		labels.set(folder, counts);
		const label = raw.preset?.category;
		if (label) counts.set(label, (counts.get(label) ?? 0) + 1);
	}
	// A folder's label: the category most of its presets name.
	const categories = [...labels].map(([folder, counts]) => ({
		folder,
		label: [...counts].sort((a, b) => b[1] - a[1])[0]?.[0] ?? folder
	}));
	return { categories, files };
}

async function readBody(req: IncomingMessage): Promise<string> {
	let size = 0;
	const parts: Buffer[] = [];
	for await (const c of req as AsyncIterable<Buffer>) {
		size += c.length;
		if (size > MAX_BODY) throw new Error('too large');
		parts.push(c);
	}
	return Buffer.concat(parts).toString('utf8');
}

function save(body: string, res: ServerResponse): void {
	const { folder, file, project, replace } = JSON.parse(body) as {
		folder?: unknown;
		file?: unknown;
		project?: { preset?: { kind?: string } };
		replace?: unknown;
	};
	if (typeof folder !== 'string' || typeof file !== 'string' || !NAME.test(folder) || !NAME.test(file))
		return send(res, 400, { error: 'Bad category or file name' });
	if (project?.preset?.kind !== 'project') return send(res, 400, { error: 'Not a project preset' });
	const dir = join(PRESET_DIR, 'project', folder);
	const path = join(dir, `${file}.json`);
	if (existsSync(path) && replace !== true) return send(res, 409, { error: `${folder}/${file} already exists` });
	mkdirSync(dir, { recursive: true });
	writeFileSync(path, JSON.stringify(project, null, 2) + '\n');
	send(res, 200, { path: `${folder}/${file}`, presets: writeManifest() });
}

function send(res: ServerResponse, status: number, body: unknown): void {
	res.statusCode = status;
	res.setHeader('content-type', 'application/json');
	res.end(JSON.stringify(body));
}

export function devPresets(): Plugin {
	return {
		name: 'bismith-dev-presets',
		apply: 'serve',
		configureServer(server) {
			server.middlewares.use(ROUTE, (req, res) => {
				// The server listens on every interface: another site's page must not be able to write here.
				const origin = req.headers.origin;
				if (origin && new URL(origin).host !== req.headers.host) return send(res, 403, { error: 'Other origin' });
				if (req.method === 'GET') return send(res, 200, listing());
				if (req.method !== 'POST') return send(res, 405, { error: 'GET or POST' });
				readBody(req)
					.then((body) => save(body, res))
					.catch((e: unknown) => send(res, 400, { error: e instanceof Error ? e.message : String(e) }));
			});
		}
	};
}
