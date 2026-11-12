// Stage 4 (docs/architecture.md §8): run the user-ordered post filters over the linear HDR render.

import * as THREE from 'three';
import type { PostFilter, Project } from '@/core/project';
import { Gpu, PingPong, ScratchPool, type Uniforms } from '@/gpu/context';
import { createUniforms, declareUniforms, updateUniforms } from '@/gpu/uniforms';
import { GLSL_COMMON } from '@/layers/glsl/common';
import { getPostDef } from './registry';
import type { PostContext, PostDef } from './types';

export class PostStack {
	private gpu: Gpu;
	private pp: PingPong | null = null;
	private materials = new Map<string, THREE.RawShaderMaterial>();
	private scratch: ScratchPool;
	private width = 0;
	private height = 0;
	output: THREE.Texture | null = null;
	errors = new Map<string, string>();
	/** The project and filter type being run: what the context works on. */
	private project: Project | null = null;
	private def: PostDef | null = null;
	/** The filters' context, made once: run() points it at each filter in turn. */
	private readonly ctx: PostContext;

	constructor(gpu: Gpu) {
		this.gpu = gpu;
		this.scratch = new ScratchPool(gpu);
		// oxlint-disable-next-line no-this-alias -- the context's methods read the filter being run
		const self = this;
		this.ctx = {
			filter: null as unknown as PostFilter,
			get width() {
				return self.width;
			},
			get height() {
				return self.height;
			},
			material(key, body, extra?: Uniforms) {
				const def = self.def!;
				const k = `${def.type}:${key}`;
				let mat = self.materials.get(k);
				if (!mat) {
					mat = self.gpu.material(
						GLSL_COMMON + declareUniforms(def.params) + 'uniform sampler2D tInput;\nout vec4 oColor;\n' + body,
						{
							uRes: { value: new THREE.Vector2() },
							uTile: { value: true },
							tInput: { value: null },
							...createUniforms(def.params),
							...(extra ?? {})
						}
					);
					self.materials.set(k, mat);
				}
				updateUniforms(mat.uniforms, def.params, this.filter.params);
				return mat;
			},
			run(mat, target, inputTex) {
				const u = mat.uniforms;
				if (u.uRes) (u.uRes.value as THREE.Vector2).set(target.width, target.height);
				if (u.uTile) u.uTile.value = self.project!.tileable;
				if (inputTex !== undefined && u.tInput) u.tInput.value = inputTex;
				self.gpu.run(mat, target);
			},
			// Per filter instance, so two filters of one type with different sizes don't reallocate each other's.
			scratch(name, w = self.width, h = self.height) {
				return self.scratch.get(`${this.filter.id}:${name}`, w, h);
			}
		};
	}

	private ensure(w: number, h: number): void {
		if (this.pp && this.width === w && this.height === h) return;
		this.pp?.dispose();
		this.scratch.clear();
		this.pp = new PingPong(this.gpu, w, h);
		this.width = w;
		this.height = h;
	}

	/** Run all enabled filters over `input`; the result is left in `this.output`. */
	run(project: Project, input: THREE.Texture): THREE.Texture {
		this.ensure(project.width, project.height);
		const pp = this.pp!;
		const ctx = this.ctx;
		this.errors.clear();
		this.project = project;
		// The first filter reads the input itself. Filters only write into the ping-pong, never into the input (the
		// tracer's accumulation buffer).
		let src = input;
		for (const filter of project.post) {
			if (!filter.enabled) continue;
			const def = getPostDef(filter.type);
			if (!def) continue;
			this.def = def;
			ctx.filter = filter;
			try {
				if (def.run) {
					def.run(ctx, src, pp.write);
				} else if (def.glsl) {
					const mat = ctx.material('main', def.glsl + `\nvoid main() { oColor = post(ivec2(gl_FragCoord.xy)); }\n`);
					ctx.run(mat, pp.write, src);
				}
				pp.swap();
				src = pp.read.texture;
			} catch (e) {
				this.errors.set(filter.id, e instanceof Error ? e.message : String(e));
			}
		}
		// No filter ran: the output is a copy, which holds still while the tracer accumulates (and probe reads).
		if (src === input) {
			this.gpu.copy(input, pp.write);
			pp.swap();
		}
		this.def = null;
		this.output = pp.read.texture;
		return this.output;
	}

	/** One texel of the output (linear RGBA), rows top-down; null before the first run. */
	probe(x: number, y: number): Float32Array | null {
		if (!this.output || !this.pp || x < 0 || y < 0 || x >= this.width || y >= this.height) return null;
		const buf = new Float32Array(4);
		this.gpu.renderer.readRenderTargetPixels(this.pp.read, x, this.height - 1 - y, 1, 1, buf);
		return buf;
	}

	dispose(): void {
		this.pp?.dispose();
		for (const m of this.materials.values()) m.dispose();
		this.scratch.clear();
	}
}
