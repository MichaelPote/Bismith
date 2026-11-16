#!/usr/bin/env node
// Releases the "Upcoming changes" section of CHANGELOG.md: renames its heading to "Version X.Y.Z".
//
// npm runs this as the `version` lifecycle script, after `npm version` has bumped package.json and before it
// commits and tags, so the version comes from package.json and the renamed section lands in the version commit:
//   "version": "node tools/changelog-release.mjs && git add CHANGELOG.md"
// Outside npm, pass the version: node changelog-release.mjs 1.2.0
import { existsSync, readFileSync, writeFileSync } from 'node:fs';

const FILE = 'CHANGELOG.md';
const NO_CHANGES = '- No notable changes.';
const UPCOMING = /^##\s+Upcoming changes\s*$/i;
const SECTION = /^##\s/;

const fail = (msg) => {
	console.error(`changelog-release: ${msg}`);
	process.exit(1);
};

const raw = process.argv[2] ?? JSON.parse(readFileSync('package.json', 'utf8')).version;
const version = String(raw).replace(/^v/, '');
if (!/^\d+\.\d+\.\d+/.test(version)) fail(`"${raw}" is not a version (X.Y.Z)`);

if (!existsSync(FILE)) {
	console.warn(`changelog-release: no ${FILE} here, nothing to do`);
	process.exit(0);
}

const text = readFileSync(FILE, 'utf8');
const eol = text.includes('\r\n') ? '\r\n' : '\n';
const lines = text.split(/\r?\n/);
const heading = `## Version ${version}`;
const escaped = version.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const sameVersion = new RegExp(`^##\\s+Version\\s+v?${escaped}\\s*$`, 'i');

const at = lines.findIndex((l) => UPCOMING.test(l));
if (lines.some((l) => sameVersion.test(l))) {
	if (at < 0) {
		console.log(`changelog-release: ${FILE} already has "${heading}"`);
		process.exit(0);
	}
	fail(`${FILE} has both "${heading}" and "Upcoming changes"; merge them by hand`);
}

if (at >= 0) {
	let end = lines.findIndex((l, i) => i > at && SECTION.test(l));
	if (end < 0) end = lines.length;
	lines[at] = heading;
	if (!lines.slice(at + 1, end).some((l) => l.trim() !== '')) {
		lines.splice(at + 1, end - at - 1, '', NO_CHANGES, '');
		console.warn(`changelog-release: "Upcoming changes" was empty`);
	}
} else {
	// No Upcoming changes section: put the version above the newest one (or at the end).
	const first = lines.findIndex((l) => SECTION.test(l));
	if (first >= 0) lines.splice(first, 0, heading, '', NO_CHANGES, '');
	else {
		while (lines.length && lines.at(-1).trim() === '') lines.pop();
		lines.push('', heading, '', NO_CHANGES, '');
	}
	console.warn(`changelog-release: no "Upcoming changes" section`);
}

writeFileSync(FILE, lines.join(eol));
console.log(`changelog-release: ${FILE} now lists "${heading}"`);
