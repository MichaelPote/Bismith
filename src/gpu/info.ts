// What the GPU is, for logs and the gallery's visitor fingerprint.

type GL = WebGLRenderingContext | WebGL2RenderingContext;

/** The GPU's renderer string: the unmasked one where the browser gives it (e.g. "ANGLE (NVIDIA …, D3D11)"). */
export function glRenderer(gl: GL): string {
	const ext = gl.getExtension('WEBGL_debug_renderer_info');
	return String(gl.getParameter(ext ? ext.UNMASKED_RENDERER_WEBGL : gl.RENDERER));
}

/** The GPU's vendor string, unmasked where the browser gives it. */
export function glVendor(gl: GL): string {
	const ext = gl.getExtension('WEBGL_debug_renderer_info');
	return String(gl.getParameter(ext ? ext.UNMASKED_VENDOR_WEBGL : gl.VENDOR));
}
