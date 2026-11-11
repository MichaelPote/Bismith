// Shader compile failures, read from three's per-program diagnostics rather than its onShaderError callback: that fires
// once per program, at its first use, so a broken program that's cached (a later render, another material with the
// same source, a variant compiled in the background) runs again silently — black, or with nothing reported.

/** The part of three's WebGLProgram.diagnostics this reads (set at the program's first use when its link failed). */
export interface ProgramDiagnostics {
	runnable: boolean;
	programLog: string;
	vertexShader: { log: string };
	fragmentShader: { log: string };
}

/** What `renderer.properties.get(material)` holds for a material three has drawn (or compiled). */
export interface MaterialProgramProps {
	currentProgram?: { diagnostics?: ProgramDiagnostics };
}

/** A material's compile error once three has used its program: the compiler's log, or null when it runs. */
export function programError(props: MaterialProgramProps | undefined): string | null {
	const d = props?.currentProgram?.diagnostics;
	if (!d || d.runnable) return null;
	const log = [d.fragmentShader.log, d.vertexShader.log, d.programLog]
		.map((s) => s.trim())
		.filter(Boolean)
		.join('\n');
	return log || 'Shader failed to compile';
}
