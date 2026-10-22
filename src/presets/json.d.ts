// Preset files (presets/*.json, imported by builtin.ts) are read as untyped data: normalizeProject validates them, and
// typing ~300 KB of JSON would slow the typecheck for nothing.
declare module '*.json' {
	const value: unknown;
	export default value;
}
