// Project previews (FR8.20): an optional small image data URL in the project file, kept when it is one.

import { describe, expect, it } from 'vitest';
import {
	createProject,
	isPreview,
	normalizeProject,
	PREVIEW_LIMIT,
	projectFromJSON,
	projectToJSON
} from '@/core/serialize';

const WEBP = 'data:image/webp;base64,UklGRhYAAABXRUJQVlA4TAoAAAAvAAAAAE0AAA==';

describe('project preview', () => {
	it('survives a save and load, after everything else', () => {
		const p = { ...createProject({ name: 'With preview' }), preview: WEBP };
		const text = projectToJSON(p);
		expect(projectFromJSON(text).preview).toBe(WEBP);
		expect(Object.keys(JSON.parse(projectToJSON(normalizeProject(JSON.parse(text))))).at(-1)).toBe('preview');
	});

	it('is optional', () => {
		expect(normalizeProject(createProject()).preview).toBeUndefined();
		expect('preview' in normalizeProject(createProject())).toBe(false);
	});

	it('drops anything that is not a small image data URL', () => {
		for (const bad of [
			42,
			'https://example.com/a.webp',
			'data:text/html;base64,PGI+',
			'data:image/webp;base64,<script>',
			`data:image/jpeg;base64,${'A'.repeat(PREVIEW_LIMIT)}`
		]) {
			expect(isPreview(bad), String(bad).slice(0, 40)).toBe(false);
			expect(normalizeProject({ ...createProject(), preview: bad }).preview).toBeUndefined();
		}
		expect(isPreview('data:image/jpeg;base64,/9j/4AAQ')).toBe(true);
	});
});
