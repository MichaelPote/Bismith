import { createApp } from 'vue';
import { createPinia } from 'pinia';
import '@fontsource/ibm-plex-sans/400.css';
import '@fontsource/ibm-plex-sans/500.css';
import '@fontsource/ibm-plex-sans/700.css';
import '@fontsource/ibm-plex-mono/400.css';
import '@fontsource/ibm-plex-mono/500.css';
import '@fontsource/cormorant-garamond/500.css';
import '@fontsource/cormorant-garamond/600.css';
import './styles/tokens.css';
import './styles/base.css';
import App from './App.vue';

const root = document.getElementById('app')!;
const params = new URLSearchParams(location.search);
// The harness's page and the GPU tools' editor (tools/backend.ts, tools/editor.ts) run on the dev server only: the build
// drops these branches and their modules.
if (import.meta.env.DEV && params.has('headless')) {
	void import('./headless').then((m) => m.bootHeadless(root));
} else {
	createApp(App).use(createPinia()).mount(root);
	if (import.meta.env.DEV && params.has('editor'))
		void import('./editorDriver').then((m) => m.startEditorDriver(params.get('worker') ?? '0'));
}
