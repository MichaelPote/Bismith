// Build the app and upload dist/ to its Cloudflare Worker as static assets (wrangler.jsonc):
//
//   npm run deploy                  build, then deploy
//   npm run deploy -- --no-build    deploy dist/ as it is
//   npm run deploy -- --dry-run     build and check the upload without sending it (other flags go to wrangler deploy)
//
// Needs wrangler (`npm install -g wrangler`; found on PATH or in npm's global bin) and, from the environment or a
// `.env.local` file in the repo root (git-ignored; never commit the token):
//
//   CLOUDFLARE_API_TOKEN=…     an API token with Workers Scripts: Edit on the account
//   CLOUDFLARE_ACCOUNT_ID=…    the account the worker belongs to (optional when the token can see only one)
//   CLOUDFLARE_WORKER_NAME=…   optional: deploy to another worker than wrangler.jsonc's `name`

import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/** KEY=value lines of .env.local (# comments, optional quotes); the environment wins over the file. */
function loadEnvFile(file: string): void {
	if (!existsSync(file)) return;
	for (const line of readFileSync(file, 'utf8').split(/\r?\n/)) {
		const m = /^\s*(?:export\s+)?([A-Z0-9_]+)\s*=\s*(.*?)\s*$/.exec(line);
		if (!m || line.trimStart().startsWith('#')) continue;
		const value = m[2].replace(/^(['"])(.*)\1$/, '$2');
		if (process.env[m[1]] === undefined) process.env[m[1]] = value;
	}
}

/** The wrangler command: on PATH, or in npm's global bin (nvm's isn't always on PATH). */
function findWrangler(): string {
	const onPath = spawnSync('wrangler', ['--version'], { stdio: 'ignore' });
	if (onPath.status === 0) return 'wrangler';
	try {
		const prefix = execFileSync('npm', ['config', 'get', 'prefix'], { encoding: 'utf8' }).trim();
		const bin = join(prefix, 'bin', 'wrangler');
		if (existsSync(bin)) return bin;
	} catch {
		/* no npm: fall through */
	}
	throw new Error('wrangler not found: npm install -g wrangler');
}

function run(cmd: string, args: string[]): void {
	const r = spawnSync(cmd, args, { cwd: ROOT, stdio: 'inherit', env: process.env });
	if (r.status !== 0) process.exit(r.status ?? 1);
}

loadEnvFile(join(ROOT, '.env.local'));
const args = process.argv.slice(2);
const build = !args.includes('--no-build');
const passThrough = args.filter((a) => a !== '--no-build');
const dryRun = passThrough.includes('--dry-run');

if (!dryRun && !process.env.CLOUDFLARE_API_TOKEN) {
	console.error('CLOUDFLARE_API_TOKEN is not set (export it, or put it in .env.local).');
	process.exit(1);
}
const wrangler = findWrangler();
if (build) run('npm', ['run', 'build']);
if (!existsSync(join(ROOT, 'dist', 'index.html'))) {
	console.error('dist/index.html is missing: build first (drop --no-build).');
	process.exit(1);
}
const name = process.env.CLOUDFLARE_WORKER_NAME;
run(wrangler, ['deploy', ...(name ? ['--name', name] : []), ...passThrough]);
