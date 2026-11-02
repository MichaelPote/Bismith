/// <reference types="vite/client" />

interface ImportMetaEnv {
	/** The Bismith Gallery (src/gallery/client.ts); default https://gallery.bismith.dev. */
	readonly VITE_GALLERY_URL?: string;
}

/** package.json's version, from vite.config.ts's define. */
declare const __APP_VERSION__: string;

declare module '*.vue' {
	import type { DefineComponent } from 'vue';
	const component: DefineComponent<object, object, unknown>;
	export default component;
}
