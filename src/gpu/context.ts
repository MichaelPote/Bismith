// Thin WebGL2 plumbing over Three.js: one renderer, one full-screen triangle, float render targets,
// shader materials composed from GLSL chunks, and float readback.

import * as THREE from 'three';
import { FULLSCREEN_VERT, GLSL_HEADER } from '@/layers/glsl/common';
import { type MaterialProgramProps, programError } from './shaderErrors';

export type Uniforms = Record<string, THREE.IUniform>;

export interface TargetOptions {
	count?: number;
	linear?: boolean;
	/** Wrap mode for sampled (not texelFetch) reads; clamp to edge by default. Fixed at creation (three never re-applies
	 * a render target texture's sampler state). */
	wrap?: THREE.Wrapping;
}

export class GpuError extends Error {}

/** Copy targets readTexture keeps (one per size). */
const READ_TARGETS = 3;

export class Gpu {
	readonly renderer: THREE.WebGLRenderer;
	readonly canvas: HTMLCanvasElement;
	private readonly scene = new THREE.Scene();
	private readonly camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
	private readonly mesh: THREE.Mesh;
	private readonly copyMat: THREE.RawShaderMaterial;
	/** Copy targets of readTexture by size, least recently used first. */
	private readonly readTargets = new Map<string, THREE.WebGLRenderTarget>();
	private readonly canvasSize = new THREE.Vector2();
	private readonly clearColor = new THREE.Color();
	/** The browser compiles shaders off the main thread (KHR_parallel_shader_compile): compile() doesn't stall. */
	readonly parallelCompile: boolean;
	/** Compile errors of the passes run since the last takeErrors(), each log once. */
	private runErrors = new Set<string>();

	constructor(canvas: HTMLCanvasElement) {
		this.canvas = canvas;
		let renderer: THREE.WebGLRenderer;
		try {
			renderer = new THREE.WebGLRenderer({
				canvas,
				antialias: false,
				alpha: true,
				premultipliedAlpha: false,
				preserveDrawingBuffer: true,
				powerPreference: 'high-performance'
			});
		} catch {
			throw new GpuError('WebGL2 is not available in this browser.');
		}
		const gl = renderer.getContext() as WebGL2RenderingContext;
		if (!gl.getExtension('EXT_color_buffer_float')) {
			throw new GpuError('This GPU/browser cannot render to float textures (EXT_color_buffer_float).');
		}
		// Linear filtering of float targets (the tracer's height reads, post's `linear` scratch targets).
		gl.getExtension('OES_texture_float_linear');
		renderer.autoClear = false;
		// The output colour space stays three's default: setting it assigns gl.drawingBufferColorSpace, and Firefox (seen
		// with Windows HDR) then colour-manages the canvas and shifts its hues, though the value is 'srgb' either way. Our
		// shaders write display values themselves (RawShaderMaterial gets no output conversion); only the clear colour
		// goes through it, so clearCanvas passes that as sRGB.
		this.renderer = renderer;
		this.parallelCompile = renderer.extensions.has('KHR_parallel_shader_compile');

		const geo = new THREE.BufferGeometry();
		geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array([-1, -1, 0, 3, -1, 0, -1, 3, 0]), 3));
		this.mesh = new THREE.Mesh(geo);
		this.mesh.frustumCulled = false;
		this.scene.add(this.mesh);

		this.copyMat = this.material(
			/* glsl */ `
      uniform sampler2D tSrc;
      out vec4 oColor;
      void main() { oColor = texelFetch(tSrc, ivec2(gl_FragCoord.xy), 0); }
    `,
			{ tSrc: { value: null } }
		);
	}

	get gl(): WebGL2RenderingContext {
		return this.renderer.getContext() as WebGL2RenderingContext;
	}

	/** A full-screen pass material. `frag` should not include the version/precision header. */
	material(frag: string, uniforms: Uniforms): THREE.RawShaderMaterial {
		return new THREE.RawShaderMaterial({
			glslVersion: THREE.GLSL3,
			vertexShader: GLSL_HEADER + FULLSCREEN_VERT,
			fragmentShader: GLSL_HEADER + frag,
			uniforms,
			depthTest: false,
			depthWrite: false,
			blending: THREE.NoBlending
		});
	}

	/**
	 * Compile pass materials' programs ahead of their first run. Where the browser has KHR_parallel_shader_compile the
	 * compile happens off the main thread and this resolves when it is done; elsewhere it resolves at once and the first
	 * run pays for the compile.
	 */
	async compile(materials: THREE.Material[]): Promise<void> {
		const group = new THREE.Group();
		for (const m of materials) group.add(new THREE.Mesh(this.mesh.geometry, m));
		await this.renderer.compileAsync(group, this.camera, this.scene);
	}

	target(width: number, height: number, opts: TargetOptions = {}): THREE.WebGLRenderTarget {
		const filter = opts.linear ? THREE.LinearFilter : THREE.NearestFilter;
		const wrap = opts.wrap ?? THREE.ClampToEdgeWrapping;
		const t = new THREE.WebGLRenderTarget(width, height, {
			count: opts.count ?? 1,
			type: THREE.FloatType,
			format: THREE.RGBAFormat,
			minFilter: filter,
			magFilter: filter,
			depthBuffer: false,
			stencilBuffer: false,
			generateMipmaps: false,
			wrapS: wrap,
			wrapT: wrap
		});
		for (const tex of t.textures) tex.colorSpace = THREE.NoColorSpace;
		return t;
	}

	/** Run a full-screen pass into `target` (null = canvas). Optionally restrict to a viewport (px). */
	run(
		material: THREE.Material,
		target: THREE.WebGLRenderTarget | null,
		viewport?: { x: number; y: number; w: number; h: number }
	): void {
		this.mesh.material = material;
		const r = this.renderer;
		// A target's viewport is copied when it is bound, so it is set first (after, it would only apply to the next run).
		if (target) {
			if (viewport) target.viewport.set(viewport.x, viewport.y, viewport.w, viewport.h);
			else target.viewport.set(0, 0, target.width, target.height);
		}
		r.setRenderTarget(target);
		if (!target && viewport) {
			const pr = r.getPixelRatio();
			r.setViewport(viewport.x / pr, viewport.y / pr, viewport.w / pr, viewport.h / pr);
		} else if (!target) {
			const s = r.getSize(this.canvasSize);
			r.setViewport(0, 0, s.x, s.y);
		}
		r.render(this.scene, this.camera);
		const err = this.programError(material);
		if (err) this.runErrors.add(err);
	}

	/** The material's compile error once it has run (or null): every time it runs, not only the first (see shaderErrors.ts). */
	programError(material: THREE.Material): string | null {
		return programError(this.renderer.properties.get(material) as MaterialProgramProps);
	}

	/** The compile errors of the passes run since the last call (joined, or null when they all ran), and forget them. */
	takeErrors(): string | null {
		if (!this.runErrors.size) return null;
		const e = [...this.runErrors].join('\n');
		this.runErrors.clear();
		return e;
	}

	clearCanvas(r = 0, g = 0, b = 0, a = 0): void {
		this.renderer.setRenderTarget(null);
		this.renderer.setClearColor(this.clearColor.setRGB(r, g, b, THREE.SRGBColorSpace), a);
		this.renderer.clear(true, false, false);
	}

	/** Copy a texture texel for texel into `target` (from its bottom-left corner). */
	copy(src: THREE.Texture, target: THREE.WebGLRenderTarget): void {
		this.copyMat.uniforms.tSrc.value = src;
		this.run(this.copyMat, target);
	}

	/**
	 * Read the bottom-left width × height texels of any texture back as RGBA float (rows bottom-up, GL order): straight
	 * from its render target when it is a float RGBA attachment, else through a copy into a read target of that size.
	 */
	readTexture(texture: THREE.Texture, width: number, height: number): Float32Array {
		const out = new Float32Array(width * height * 4);
		const owner = (texture as THREE.Texture & { renderTarget?: THREE.WebGLRenderTarget | null }).renderTarget;
		const direct =
			owner?.isWebGLRenderTarget &&
			texture.type === THREE.FloatType &&
			texture.format === THREE.RGBAFormat &&
			owner.width >= width &&
			owner.height >= height &&
			// Never rendered to: no framebuffer to read yet.
			(this.renderer.properties.get(owner) as { __webglFramebuffer?: unknown }).__webglFramebuffer;
		if (direct) {
			this.renderer.readRenderTargetPixels(owner, 0, 0, width, height, out, undefined, owner.textures.indexOf(texture));
		} else {
			const t = this.readTargetFor(width, height);
			this.copy(texture, t);
			this.renderer.readRenderTargetPixels(t, 0, 0, width, height, out);
		}
		return out;
	}

	/** readTexture with the rows top-down (image order), flipped in place. */
	readTopDown(texture: THREE.Texture, width: number, height: number): Float32Array {
		const data = this.readTexture(texture, width, height);
		const row = width * 4;
		const tmp = new Float32Array(row);
		for (let y = 0, z = height - 1; y < z; y++, z--) {
			const a = data.subarray(y * row, (y + 1) * row);
			const b = data.subarray(z * row, (z + 1) * row);
			tmp.set(a);
			a.set(b);
			b.set(tmp);
		}
		return data;
	}

	/** A copy target for reads of this size, kept for the next (the few sizes in use — small and full — stay cached). */
	private readTargetFor(width: number, height: number): THREE.WebGLRenderTarget {
		const key = `${width}x${height}`;
		let t = this.readTargets.get(key);
		if (t) this.readTargets.delete(key);
		else t = this.target(width, height);
		this.readTargets.set(key, t);
		while (this.readTargets.size > READ_TARGETS) {
			const [k, old] = this.readTargets.entries().next().value!;
			old.dispose();
			this.readTargets.delete(k);
		}
		return t;
	}

	dispose(): void {
		for (const t of this.readTargets.values()) t.dispose();
		this.copyMat.dispose();
		this.mesh.geometry.dispose();
		this.renderer.dispose();
	}
}

/** A pair of identical targets for ping-pong passes. */
export class PingPong {
	read: THREE.WebGLRenderTarget;
	write: THREE.WebGLRenderTarget;

	constructor(gpu: Gpu, width: number, height: number, opts: TargetOptions = {}) {
		this.read = gpu.target(width, height, opts);
		this.write = gpu.target(width, height, opts);
	}

	swap(): void {
		const t = this.read;
		this.read = this.write;
		this.write = t;
	}

	get width(): number {
		return this.read.width;
	}

	get height(): number {
		return this.read.height;
	}

	dispose(): void {
		this.read.dispose();
		this.write.dispose();
	}
}

/**
 * Float scratch targets cached by name: asking for a name at another size replaces its target, so sizes that follow a
 * param (a slider being dragged) don't pile up targets. A name keeps the options it was first created with.
 */
export class ScratchPool {
	private readonly gpu: Gpu;
	private targets = new Map<string, THREE.WebGLRenderTarget>();

	constructor(gpu: Gpu) {
		this.gpu = gpu;
	}

	get(name: string, width: number, height: number, opts?: TargetOptions): THREE.WebGLRenderTarget {
		let t = this.targets.get(name);
		if (t && (t.width !== width || t.height !== height)) {
			t.dispose();
			t = undefined;
		}
		if (!t) {
			t = this.gpu.target(width, height, opts);
			this.targets.set(name, t);
		}
		return t;
	}

	/** Free every target (they are made again on demand). */
	clear(): void {
		for (const t of this.targets.values()) t.dispose();
		this.targets.clear();
	}
}
