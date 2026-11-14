# FR7.1 — GPU harness (Windows headless Chrome)

**Status:** done (v1)

## Goal

GPU acceleration is a must for emulating thousands of textures. Under WSL2, Playwright's bundled Chromium only
gets CPU SwiftShader in headless mode, so drive **headless Chrome on the Windows host** instead (native
ANGLE/D3D11 on the RTX 5080) — without a visible window and without exposing a DevTools port.

## Design

- `tools/backend.ts` — one RPC for every tool: `session.call(method, …args)` / `callOn(worker, …)` runs
  `window.__bismith[method](…args)` in a headless page.
- **windows** backend: Vite listens on `0.0.0.0` (Windows reaches it via WSL localhost forwarding); a small Vite
  plugin serves a long-poll job queue under `/__bismith/` (`job`, `result`, `hello`, `log`). Each worker is a
  Windows `chrome.exe --headless=new --use-angle=d3d11` (own `--user-data-dir` tagged `bismith-gpu-<port>`)
  opening `/?headless&worker=K`; the page's worker loop (`src/headless.ts`) pulls jobs and posts results.
  WSL → Windows connections are blocked by the firewall, so traffic only flows Windows → WSL. Browsers are
  killed by tag on close / Ctrl-C.
- **Low priority.** The browsers run at Below Normal priority (`BISMITH_PRIORITY`: `Idle`, `BelowNormal`, `Normal`):
  at Normal, long renders made the desktop stutter in bursts. Windows takes a process's GPU scheduling priority from
  its priority class. The launching PowerShell lowers itself first, so Chrome and the children it starts inherit the
  class; but Chrome raises its GPU process to Above Normal when it starts it (at launch, and again after a driver
  reset), so every process with the session's tag is set back once the workers are up and then every 15 s.
- **swiftshader** backend: the previous Playwright path, kept as a portable fallback.
- `--backend windows|swiftshader` on every harness command (`--workers N` on the batch tools that spread work over
  pages: emulate, matchbench, tiling); `BISMITH_BACKEND` env var.
- **The editor on the GPU** (`tools/editor.ts`, `openEditor()`; `tools/shot.ts` uses it): for checks that go through the
  UI. Windows Chrome opens `/?editor&worker=0`, the normal app plus `src/editorDriver.ts` (dev server only; the build
  drops it), which pulls `eval` and `cdp` jobs from the same queue. Since nothing in WSL can reach the browser's DevTools
  port, the page opens that socket on itself (`--remote-debugging-port=0`, the port read from the profile's
  `DevToolsActivePort`), for trusted clicks, drags and keys and for screenshots. It has its own profile
  (`bismith-gpu-editor-<port>`), storage cleared on open and its shader cache kept. On SwiftShader the same API is
  plain Playwright.

## Findings

- Headed Chromium in WSLg also reaches the GPU (Mesa d3d12 → RTX 5080) but opens a window; Windows headless is
  cleaner. Probe: `npx tsx tools/gpu-probe.ts`.
- 64² render, 16 spp: 2 ms GPU vs 4 ms SwiftShader (tiny); evaluation cost is now dominated by readback and the
  JS metric (~9 ms/eval vs 18 ms). Parallel workers scale with CPU cores. First render per shader compiles HLSL
  (seconds) — amortised over a run.

## Checklist

- [x] GPU feasibility probe (WSLg headed and Windows headless)
- [x] Job-queue transport (Vite middleware + page worker loop)
- [x] Windows headless Chrome launcher with tagged cleanup
- [x] Backend abstraction used by harness render / compare / optimize
- [x] Multi-worker sessions
- [x] Benchmark tool (`tools/bench.ts`)
- [x] The real editor on the GPU, driven through its UI (`tools/editor.ts`)
