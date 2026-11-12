// Command-line helpers shared by the tools: the repo root, flag parsing and input expansion.

import { existsSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/** The repository root. */
export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

export interface Args {
	positional: string[];
	/** `--key value` → 'value'; a bare `--key` (or one in `bools`) → true. */
	flags: Record<string, string | true>;
}

/**
 * Split `argv` into positionals and flags: `--key value` takes the next argument unless it starts with `--` (or the key
 * is one of `bools`, which never take one), else the flag is just true.
 */
export function parseArgs(argv: string[] = process.argv.slice(2), bools: string[] = []): Args {
	const positional: string[] = [];
	const flags: Args['flags'] = {};
	for (let i = 0; i < argv.length; i++) {
		const a = argv[i];
		if (!a.startsWith('--')) {
			positional.push(a);
			continue;
		}
		const key = a.slice(2);
		const next = argv[i + 1];
		if (!bools.includes(key) && next !== undefined && !next.startsWith('--')) {
			flags[key] = next;
			i++;
		} else flags[key] = true;
	}
	return { positional, flags };
}

/** A flag's value, or `def` when it is absent or given without one. */
export function str(args: Args, key: string): string | undefined;
export function str(args: Args, key: string, def: string): string;
export function str(args: Args, key: string, def?: string): string | undefined {
	const v = args.flags[key];
	return typeof v === 'string' ? v : def;
}

/** A flag's numeric value, or `def` when it is absent or given without one; anything else but a number throws. */
export function num(args: Args, key: string): number | undefined;
export function num(args: Args, key: string, def: number): number;
export function num(args: Args, key: string, def?: number): number | undefined {
	const v = args.flags[key];
	if (typeof v !== 'string') return def;
	const n = Number(v);
	if (!Number.isFinite(n)) throw new Error(`--${key}: not a number: ${v}`);
	return n;
}

/** Whether a flag is given (with or without a value). */
export const has = (args: Args, key: string): boolean => key in args.flags;

/** Files and directories as a file list: a directory gives its files that `keep` takes (by name, sorted). */
export function expandInputs(inputs: string[], keep: (name: string) => boolean): string[] {
	const out: string[] = [];
	for (const p of inputs) {
		if (!existsSync(p)) continue;
		if (statSync(p).isDirectory()) {
			for (const f of readdirSync(p).sort()) if (keep(f)) out.push(join(p, f));
		} else out.push(p);
	}
	return out;
}
