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
import { bootHeadless } from './headless';

const root = document.getElementById('app')!;
const params = new URLSearchParams(location.search);
if (params.has('headless')) {
	bootHeadless(root);
} else {
	createApp(App).use(createPinia()).mount(root);
	// The GPU tools' editor (tools/editor.ts). Dev server only: the build drops this branch and the module.
	if (import.meta.env.DEV && params.has('editor'))
		void import('./editorDriver').then((m) => m.startEditorDriver(params.get('worker') ?? '0'));
}
