import { fileURLToPath, URL } from 'node:url';
import { defineConfig } from 'vitest/config';
import vue from '@vitejs/plugin-vue';

// https://vite.dev/config/
export default defineConfig({
	// Relative asset URLs: the built app works from any folder or vhost (e.g. dist/ served directly).
	base: './',
	plugins: [vue()],
	resolve: {
		alias: {
			'@': fileURLToPath(new URL('./src', import.meta.url))
		}
	},
	server: {
		// Bind to all interfaces so the WSL2 localhost relay (and the WSL IP)
		// can reach the dev server from the Windows host.
		host: true,
		port: 5173,
		strictPort: true
	},
	build: {
		rolldownOptions: {
			output: {
				// Libraries in chunks of their own: they change less often than the app, so stay cached across deploys.
				codeSplitting: {
					groups: [
						// three/build only: the EXR / HDR loaders in three/examples stay lazy chunks of their own.
						{ name: 'three', test: /node_modules[\\/]three[\\/]build[\\/]/, priority: 3 },
						{ name: 'vue', test: /node_modules[\\/](@vue|vue|pinia)[\\/]/, priority: 2 },
						{ name: 'vendor', test: /node_modules[\\/](?!three[\\/])/, priority: 1 }
					]
				}
			}
		},
		// The app's own chunk (~2.4 MB, mostly generator shaders and presets) loads up front in an editor anyway.
		chunkSizeWarningLimit: 2600
	},
	test: {
		include: ['tests/**/*.test.ts']
	}
});
