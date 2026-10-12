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
- **swiftshader** backend: the previous Playwright path, kept as a portable fallback.
- `--backend windows|swiftshader`, `--workers N` on every harness command; `BISMITH_BACKEND` env var.

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
