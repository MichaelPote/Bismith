import { describe, expect, it } from 'vitest';
import { type ProgramDiagnostics, programError } from '@/gpu/shaderErrors';

const diag = (runnable: boolean, fs = '', vs = '', program = ''): ProgramDiagnostics => ({
	runnable,
	programLog: program,
	vertexShader: { log: vs },
	fragmentShader: { log: fs }
});

describe('programError', () => {
	it('is null before three has used the program, or when it runs', () => {
		expect(programError(undefined)).toBeNull();
		expect(programError({})).toBeNull();
		expect(programError({ currentProgram: {} })).toBeNull();
		expect(programError({ currentProgram: { diagnostics: diag(true, 'WARNING: 0:1: unused') } })).toBeNull();
	});

	it("is the compiler's log for a program that failed, every time it is read", () => {
		const props = {
			currentProgram: { diagnostics: diag(false, "ERROR: 0:812: 'cw' : redefinition\n", '', 'link failed ') }
		};
		const log = "ERROR: 0:812: 'cw' : redefinition\nlink failed";
		// three calls onShaderError only at a program's first use; the diagnostics stay on the (cached) program.
		expect(programError(props)).toBe(log);
		expect(programError(props)).toBe(log);
	});

	it('says the shader failed when the driver gives no log', () => {
		expect(programError({ currentProgram: { diagnostics: diag(false) } })).toBe('Shader failed to compile');
	});
});
