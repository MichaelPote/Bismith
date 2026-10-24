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
		// three.js dominates the single app chunk; an editor loads it up front anyway.
		chunkSizeWarningLimit: 1200
	},
	test: {
		include: ['tests/**/*.test.ts']
	}
});
