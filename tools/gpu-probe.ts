// Probe which Chromium launch mode gives a hardware WebGL2 context (WSL2: Mesa d3d12 → host GPU).
//   npx tsx tools/gpu-probe.ts
import { chromium } from 'playwright';
import { chromiumEnv } from './backend';

async function main() {
	const env = chromiumEnv();
	env.GALLIUM_DRIVER = 'd3d12';
	env.MESA_D3D12_DEFAULT_ADAPTER_NAME = 'NVIDIA';
	const configs: [string, string[]][] = [
		['headed x11 angle-gl', ['--ozone-platform=x11', '--use-gl=angle', '--use-angle=gl', '--ignore-gpu-blocklist']],
		[
			'headed wayland angle-gl',
			['--ozone-platform=wayland', '--use-gl=angle', '--use-angle=gl', '--ignore-gpu-blocklist']
		]
	];
	for (const [name, args] of configs) {
		try {
			const browser = await chromium.launch({
				headless: false,
				channel: 'chromium',
				args: [...args, '--window-position=-2400,-2400', '--window-size=200,200'],
				env
			});
			const page = await browser.newPage({ viewport: { width: 160, height: 120 } });
			const r = await page.evaluate(() => {
				const c = document.createElement('canvas');
				const gl = c.getContext('webgl2');
				if (!gl) return 'no webgl2';
				const ext = gl.getExtension('WEBGL_debug_renderer_info');
				return (
					(ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER)) +
					` | float RT: ${!!gl.getExtension('EXT_color_buffer_float')}`
				);
			});
			console.log(name.padEnd(26), r);
			await browser.close();
		} catch (e) {
			console.log(name, 'ERR', (e as Error).message.split('\n')[0]);
		}
	}
}
main();
