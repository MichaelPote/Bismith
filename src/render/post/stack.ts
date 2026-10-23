// Stage 4 (docs/architecture.md §8): run the user-ordered post filters over the linear HDR render.

import * as THREE from 'three';
import type { Project } from '@/core/project';
import { Gpu, PingPong, ScratchPool, type Uniforms } from '@/gpu/context';
import { createUniforms, declareUniforms, updateUniforms } from '@/gpu/uniforms';
import { GLSL_COMMON } from '@/layers/glsl/common';
import { getPostDef } from './registry';
import type { PostContext } from './types';

export class PostStack {
	private gpu: Gpu;
	private pp: PingPong | null = null;
	private materials = new Map<string, THREE.RawShaderMaterial>();
	private scratch: ScratchPool;
	private width = 0;
	private height = 0;
	output: THREE.Texture | null = null;
	errors = new Map<string, string>();

	constructor(gpu: Gpu) {
		this.gpu = gpu;
		this.scratch = new ScratchPool(gpu);
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
		this.errors.clear();
		// Start from a copy so filters never write into the tracer's accumulation buffer.
		this.gpu.copy(input, pp.write);
		pp.swap();

		for (const filter of project.post) {
			if (!filter.enabled) continue;
			const def = getPostDef(filter.type);
			if (!def) continue;
			const ctx: PostContext = {
				filter,
				width: this.width,
				height: this.height,
				material: (key, body, extra?: Uniforms) => {
					const k = `${def.type}:${key}`;
					let mat = this.materials.get(k);
					if (!mat) {
						mat = this.gpu.material(
							GLSL_COMMON + declareUniforms(def.params) + 'uniform sampler2D tInput;\nout vec4 oColor;\n' + body,
							{
								uRes: { value: new THREE.Vector2() },
								uTile: { value: true },
								tInput: { value: null },
								...createUniforms(def.params),
								...(extra ?? {})
							}
						);
						this.materials.set(k, mat);
					}
					updateUniforms(mat.uniforms, def.params, filter.params);
					return mat;
				},
				run: (mat, target, inputTex) => {
					const u = mat.uniforms;
					if (u.uRes) (u.uRes.value as THREE.Vector2).set(target.width, target.height);
					if (u.uTile) u.uTile.value = project.tileable;
					if (inputTex !== undefined && u.tInput) u.tInput.value = inputTex;
					this.gpu.run(mat, target);
				},
				// Per filter instance, so two filters of one type with different sizes don't reallocate each other's.
				scratch: (name, w = this.width, h = this.height) => this.scratch.get(`${filter.id}:${name}`, w, h)
			};
			try {
				if (def.run) {
					def.run(ctx, pp.read.texture, pp.write);
				} else if (def.glsl) {
					const mat = ctx.material('main', def.glsl + `\nvoid main() { oColor = post(ivec2(gl_FragCoord.xy)); }\n`);
					ctx.run(mat, pp.write, pp.read.texture);
				}
				pp.swap();
			} catch (e) {
				this.errors.set(filter.id, e instanceof Error ? e.message : String(e));
			}
		}
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
