// The real editor in a browser, for tools and checks that go through its UI (FR7.1): on the GPU in the Windows browser
// when there is one, else on SwiftShader. The path tracer runs some 100× faster on the GPU, and only the GPU has D3D's
// compiler, so prefer it for anything that renders.
//
//   const page = await openEditor({ width: 1440, height: 900 });
//   await page.openProject(readFileSync('project.json', 'utf8'));
//   await page.click('button:has(.tabler-icon-plus)');
//   await page.waitFor(`document.querySelectorAll('img.thumb').length === 2`);
//   await page.screenshot('out.png');
//   await page.close();
//
// The browser's profile is its own: the user's autosave and presets are never touched.

import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';
import { chromium } from 'playwright';
import { chromiumEnv, openWindowsEditor, quietLog, resolveBackend, type BackendKind } from './backend';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
/** The editor's autosave (stores/project.ts): what a page opens with. */
const AUTOSAVE_KEY = 'bismith:project';

export interface EditorOptions {
	backend?: BackendKind | 'auto';
	width?: number;
	height?: number;
	/** Print the page's console errors and warnings (default true). */
	logPage?: boolean;
}

export interface Clip {
	x: number;
	y: number;
	width: number;
	height: number;
}

export interface EditorPage {
	backend: BackendKind;
	/** WebGL renderer string: check it says your GPU. */
	renderer: string;
	/** Evaluate a JS expression in the page (a promise is awaited); the result must be JSON-serialisable. */
	eval<T = unknown>(expr: string): Promise<T>;
	/** Wait until an expression is truthy. */
	waitFor(expr: string, timeoutMs?: number): Promise<void>;
	/** A real mouse click in the middle of the nth element a CSS selector matches. */
	click(selector: string, nth?: number): Promise<void>;
	/** A real mouse drag from the middle of the nth element a selector matches, by (dx, dy) px, over `ms`. */
	drag(selector: string, nth: number, dx: number, dy: number, ms?: number): Promise<void>;
	/** A real key press: a character, or Escape, Enter, Tab, ArrowUp… */
	key(key: string): Promise<void>;
	/** Open a project file's text, as if it were the autosave, and reload. */
	openProject(json: string): Promise<void>;
	screenshot(file: string, clip?: Clip): Promise<void>;
	close(): Promise<void>;
}

const VK: Record<string, number> = {
	Escape: 27,
	Enter: 13,
	Tab: 9,
	ArrowLeft: 37,
	ArrowUp: 38,
	ArrowRight: 39,
	ArrowDown: 40
};
const CLEAR_STORAGE = `localStorage.clear(), indexedDB.databases().then((l) => l.forEach((d) => indexedDB.deleteDatabase(d.name)))`;
const DRAG_STEPS = 16;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function writeShot(file: string, png: Buffer): void {
	mkdirSync(dirname(resolve(file)), { recursive: true });
	writeFileSync(file, png);
}

function withWaitFor(eval_: <T>(expr: string) => Promise<T>) {
	return async (expr: string, timeoutMs = 30_000): Promise<void> => {
		const end = Date.now() + timeoutMs;
		while (!(await eval_<unknown>(expr))) {
			if (Date.now() > end) throw new Error(`timed out waiting for: ${expr}`);
			await sleep(200);
		}
	};
}

async function gpuEditor(width: number, height: number, logPage: boolean): Promise<EditorPage> {
	const s = await openWindowsEditor({ width, height }, logPage);
	try {
		const cdp = <T = unknown>(method: string, params: unknown = {}) => s.callOn<T>(0, 'cdp', method, params);
		const evalIn = <T>(expr: string) => s.callOn<T>(0, 'eval', expr);
		const attach = async () => {
			await s.callOn(0, 'connectCdp', await s.devtoolsUrl());
			// A headless window's page is smaller than the window.
			await cdp('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false });
		};
		const reload = async () => {
			await s.reloading(() => s.callOn(0, 'reload'));
			await attach();
			await waitFor(`document.readyState === 'complete' && !!document.querySelector('canvas')`);
		};
		const waitFor = withWaitFor(evalIn);
		const centre = async (selector: string, nth: number) => {
			const at = await evalIn<{ x: number; y: number } | null>(`(() => {
				const e = document.querySelectorAll(${JSON.stringify(selector)})[${nth}];
				if (!e) return null;
				e.scrollIntoView({ block: 'nearest' });
				const r = e.getBoundingClientRect();
				return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
			})()`);
			if (!at) throw new Error(`nothing matches ${selector} [${nth}]`);
			return at;
		};
		const mouse = (type: string, at: { x: number; y: number }, held = false) =>
			cdp('Input.dispatchMouseEvent', {
				type,
				...at,
				button: type === 'mouseMoved' && !held ? 'none' : 'left',
				buttons: held ? 1 : 0,
				clickCount: type === 'mouseMoved' ? 0 : 1
			});
		await attach();
		await evalIn(CLEAR_STORAGE);
		await reload();
		return {
			backend: 'windows',
			renderer: s.renderer,
			eval: evalIn,
			waitFor,
			async click(selector, nth = 0) {
				const at = await centre(selector, nth);
				await mouse('mouseMoved', at);
				await mouse('mousePressed', at);
				await mouse('mouseReleased', at);
			},
			async drag(selector, nth, dx, dy, ms = 500) {
				const at = await centre(selector, nth);
				await mouse('mouseMoved', at);
				await mouse('mousePressed', at);
				for (let i = 1; i <= DRAG_STEPS; i++) {
					await mouse('mouseMoved', { x: at.x + (dx * i) / DRAG_STEPS, y: at.y + (dy * i) / DRAG_STEPS }, true);
					await sleep(ms / DRAG_STEPS);
				}
				await mouse('mouseReleased', { x: at.x + dx, y: at.y + dy });
			},
			async key(key) {
				const vk = VK[key] ?? key.toUpperCase().charCodeAt(0);
				const base = { key, code: VK[key] ? key : undefined, windowsVirtualKeyCode: vk };
				await cdp('Input.dispatchKeyEvent', { type: 'keyDown', ...base });
				await cdp('Input.dispatchKeyEvent', { type: 'keyUp', ...base });
			},
			async openProject(json) {
				await evalIn(`localStorage.setItem(${JSON.stringify(AUTOSAVE_KEY)}, ${JSON.stringify(json)})`);
				await reload();
			},
			async screenshot(file, clip) {
				const { data } = await cdp<{ data: string }>('Page.captureScreenshot', {
					format: 'png',
					...(clip ? { clip: { ...clip, scale: 1 } } : {})
				});
				writeShot(file, Buffer.from(data, 'base64'));
			},
			close: () => s.close()
		};
	} catch (e) {
		await s.close();
		throw e;
	}
}

async function swiftShaderEditor(width: number, height: number, logPage: boolean): Promise<EditorPage> {
	const server = await createServer({
		root: ROOT,
		configFile: join(ROOT, 'vite.config.ts'),
		logLevel: 'error',
		server: { port: 5191, strictPort: false, host: '127.0.0.1', hmr: false, watch: null }
	});
	await server.listen();
	const url = server.resolvedUrls?.local[0] ?? 'http://127.0.0.1:5191/';
	const browser = await chromium.launch({
		args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
		env: chromiumEnv()
	});
	const page = await browser.newPage({ viewport: { width, height } });
	if (logPage) {
		page.on('console', (m) => {
			if ((m.type() === 'error' || m.type() === 'warning') && !quietLog(m.text()))
				console.error(`[page ${m.type()}]`, m.text());
		});
		page.on('pageerror', (e) => console.error('[page error]', e.message));
	}
	await page.goto(url);
	await page.evaluate(CLEAR_STORAGE);
	await page.goto(url);
	const evalIn = <T>(expr: string) => page.evaluate(expr) as Promise<T>;
	return {
		backend: 'swiftshader',
		renderer: 'SwiftShader (CPU)',
		eval: evalIn,
		waitFor: withWaitFor(evalIn),
		click: (selector, nth = 0) => page.locator(selector).nth(nth).click(),
		async drag(selector, nth, dx, dy, ms = 500) {
			const box = await page.locator(selector).nth(nth).boundingBox();
			if (!box) throw new Error(`nothing matches ${selector} [${nth}]`);
			const [x, y] = [box.x + box.width / 2, box.y + box.height / 2];
			await page.mouse.move(x, y);
			await page.mouse.down();
			for (let i = 1; i <= DRAG_STEPS; i++) {
				await page.mouse.move(x + (dx * i) / DRAG_STEPS, y + (dy * i) / DRAG_STEPS);
				await sleep(ms / DRAG_STEPS);
			}
			await page.mouse.up();
		},
		key: (key) => page.keyboard.press(key),
		async openProject(json) {
			await page.evaluate(([k, v]) => localStorage.setItem(k, v), [AUTOSAVE_KEY, json]);
			await page.goto(url);
		},
		async screenshot(file, clip) {
			writeShot(file, await page.screenshot(clip ? { clip } : {}));
		},
		async close() {
			await browser.close();
			await server.close();
		}
	};
}

export function openEditor(opts: EditorOptions = {}): Promise<EditorPage> {
	const kind = resolveBackend(opts.backend === 'auto' ? undefined : opts.backend);
	const [w, h, log] = [opts.width ?? 1440, opts.height ?? 900, opts.logPage ?? true];
	return kind === 'windows' ? gpuEditor(w, h, log) : swiftShaderEditor(w, h, log);
}
