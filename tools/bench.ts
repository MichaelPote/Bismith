// Benchmark a backend: npx tsx tools/bench.ts <project.json> [--backend windows|swiftshader] [--target t.png]
import { readFileSync } from 'node:fs';
import { openSession, type BackendKind } from './backend';
import { readPng } from './png';

async function main() {
	const args = process.argv.slice(2);
	const flag = (n: string) => {
		const i = args.indexOf(`--${n}`);
		return i >= 0 ? args[i + 1] : undefined;
	};
	const project = JSON.parse(readFileSync(args[0], 'utf8'));
	const s = await openSession({ backend: flag('backend') as BackendKind | undefined, logPage: false });
	console.log(`backend ${s.backend}: ${s.renderer}`);
	try {
		await s.callOn(0, 'loadProject', project);
		for (const spp of [16, 16, 64, 256]) {
			const t0 = Date.now();
			const r = await s.callOn<{ ms: number }>(0, 'render', { samples: spp });
			console.log(`render ${spp} spp: in-page ${r.ms.toFixed(0)} ms, round-trip ${Date.now() - t0} ms`);
		}
		const tf = flag('target');
		if (tf) {
			const img = readPng(tf);
			const target = { width: img.width, height: img.height, rgba: Buffer.from(img.data).toString('base64') };
			const t0 = Date.now();
			await s.callOn(0, 'optimizeStart', target, { samples: 16 });
			const steps = await s.callOn<{ ms: number }[]>(0, 'optimizeStep', 20);
			const evals = 20 * 6;
			console.log(
				`optimize 20 steps × λ6: ${Date.now() - t0} ms (${((Date.now() - t0) / evals).toFixed(1)} ms/eval, last step ${steps[steps.length - 1].ms.toFixed(0)} ms)`
			);
		}
	} finally {
		await s.close();
	}
}
main().catch((e) => {
	console.error(e);
	process.exit(1);
});
