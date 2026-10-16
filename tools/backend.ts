// Rendering backends for the harness tools (docs/features/fr7.1-gpu-harness.md).
//
// Every backend exposes the same RPC: `call(method, ...args)` invokes `window.__bismith[method](...args)`
// in a page running the app with `?headless` and resolves with the (awaited, JSON-serialisable) result.
//
//   windows      — headless Google Chrome / Edge on the Windows host (WSL2 interop), hardware WebGL via
//                  ANGLE/D3D11. Pages pull jobs from a long-poll queue served by Vite and post results back,
//                  so no DevTools port has to cross the WSL/Windows firewall. Supports several workers.
//   swiftshader  — Playwright's bundled Chromium inside WSL with CPU SwiftShader (portable fallback).
//
// Select with `--backend windows|swiftshader` (tools parse it) or BISMITH_BACKEND; default: windows when a
// Windows browser is reachable, else swiftshader.

import { execFileSync, spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { createServer, type Plugin, type ViteDevServer } from 'vite'
import { chromium, type Browser, type Page } from 'playwright'
import type {} from '../src/headless'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')

export type BackendKind = 'windows' | 'swiftshader'

export interface SessionOptions {
  backend?: BackendKind | 'auto'
  /** Parallel pages/browsers (windows backend; swiftshader opens one page per worker in one browser). */
  workers?: number
  /** Print page console errors (default true). */
  logPage?: boolean
  /** ANGLE backend for the windows browser: d3d11 (default), gl or vulkan (env BISMITH_ANGLE). */
  angle?: 'd3d11' | 'gl' | 'vulkan'
}

export interface Session {
  backend: BackendKind
  /** WebGL renderer string reported by worker 0. */
  renderer: string
  workers: number
  /** Call on any worker (round-robin over idle workers). */
  call<T = unknown>(method: string, ...args: unknown[]): Promise<T>
  /** Call on a specific worker (keeps per-worker state such as a loaded project or optimiser). */
  callOn<T = unknown>(worker: number, method: string, ...args: unknown[]): Promise<T>
  close(): Promise<void>
}

/** Pick the backend from an explicit choice, the environment, or availability. */
export function resolveBackend(choice?: string): BackendKind {
  const c = choice ?? process.env.BISMITH_BACKEND ?? 'auto'
  if (c === 'windows' || c === 'swiftshader') return c
  return findWindowsBrowser() ? 'windows' : 'swiftshader'
}

export async function openSession(opts: SessionOptions = {}): Promise<Session> {
  const kind = resolveBackend(opts.backend === 'auto' ? undefined : opts.backend)
  return kind === 'windows' ? openWindowsSession(opts) : openSwiftShaderSession(opts)
}

// ------------------------------------------------------------------------------------------------ shared

function chromiumEnv(): Record<string, string> {
  const env: Record<string, string> = {}
  for (const [k, v] of Object.entries(process.env)) if (v !== undefined) env[k] = v
  const lib = join(ROOT, '.cache/chromium-libs/usr/lib/x86_64-linux-gnu')
  if (existsSync(lib)) env.LD_LIBRARY_PATH = [lib, join(lib, 'nss'), env.LD_LIBRARY_PATH].filter(Boolean).join(':')
  return env
}

function quietLog(text: string): boolean {
  return /GPU stall due to ReadPixels|GL Driver Message|warning X[0-9]+:|potentially uninitialized/.test(text)
}

// ------------------------------------------------------------------------------------------------ windows

const WIN_BROWSERS = [
  ['/mnt/c/Program Files/Google/Chrome/Application/chrome.exe', 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'],
  ['/mnt/c/Program Files (x86)/Google/Chrome/Application/chrome.exe', 'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe'],
  ['/mnt/c/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'],
  ['/mnt/c/Program Files/Microsoft/Edge/Application/msedge.exe', 'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe'],
] as const

function findWindowsBrowser(): { linux: string; windows: string } | null {
  if (!existsSync('/mnt/c/Windows')) return null
  for (const [linux, windows] of WIN_BROWSERS) if (existsSync(linux)) return { linux, windows }
  return null
}

function powershell(script: string): string {
  return execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], {
    cwd: '/mnt/c',
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  }).replace(/\r/g, '')
}

function windowsTemp(): string {
  return execFileSync('cmd.exe', ['/c', 'echo %TEMP%'], { cwd: '/mnt/c', encoding: 'utf8' }).replace(/\r|\n/g, '').trim()
}

/** Kill every browser process launched for this session tag (matched on its user-data-dir). */
function killTagged(tag: string): void {
  try {
    powershell(
      `Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -like '*${tag}*' } | ` +
        `ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }`,
    )
  } catch {
    /* best effort */
  }
}

interface Job {
  id: number
  method: string
  args: unknown[]
}

interface Pending {
  resolve: (v: unknown) => void
  reject: (e: Error) => void
  method: string
}

/** The Vite plugin that serves the job queue under /__bismith/. */
class JobQueue {
  private queues = new Map<number, Job[]>()
  private waiting = new Map<number, ServerResponse>()
  private pending = new Map<number, Pending>()
  private nextId = 1
  readonly ready = new Map<number, string>()
  private readyWaiters: (() => void)[] = []
  logPage = true

  enqueue<T>(worker: number, method: string, args: unknown[]): Promise<T> {
    const job: Job = { id: this.nextId++, method, args }
    return new Promise<T>((resolve, reject) => {
      this.pending.set(job.id, { resolve: resolve as (v: unknown) => void, reject, method })
      const res = this.waiting.get(worker)
      if (res) {
        this.waiting.delete(worker)
        this.send(res, 200, job)
      } else {
        const q = this.queues.get(worker) ?? []
        q.push(job)
        this.queues.set(worker, q)
      }
    })
  }

  failAll(reason: string): void {
    for (const p of this.pending.values()) p.reject(new Error(reason))
    this.pending.clear()
  }

  whenReady(n: number, timeoutMs: number): Promise<void> {
    if (this.ready.size >= n) return Promise.resolve()
    return new Promise((resolve, reject) => {
      const t = setTimeout(() => reject(new Error(`only ${this.ready.size}/${n} browser workers connected within ${timeoutMs / 1000}s`)), timeoutMs)
      this.readyWaiters.push(() => {
        if (this.ready.size >= n) {
          clearTimeout(t)
          resolve()
        }
      })
    })
  }

  private send(res: ServerResponse, status: number, body?: unknown): void {
    res.statusCode = status
    if (body === undefined) return void res.end()
    res.setHeader('content-type', 'application/json')
    res.end(JSON.stringify(body))
  }

  private async body(req: IncomingMessage): Promise<unknown> {
    const chunks: Buffer[] = []
    for await (const c of req) chunks.push(c as Buffer)
    return JSON.parse(Buffer.concat(chunks).toString('utf8') || 'null')
  }

  plugin(): Plugin {
    return {
      name: 'bismith-job-queue',
      configureServer: (server) => {
        server.middlewares.use(async (req, res, next) => {
          const url = new URL(req.url ?? '/', 'http://x')
          if (!url.pathname.startsWith('/__bismith/')) return next()
          const worker = Number(url.searchParams.get('worker') ?? 0)
          try {
            switch (url.pathname) {
              case '/__bismith/job': {
                const q = this.queues.get(worker)
                if (q && q.length) return this.send(res, 200, q.shift())
                this.waiting.get(worker)?.end()
                this.waiting.set(worker, res)
                const timer = setTimeout(() => {
                  if (this.waiting.get(worker) === res) {
                    this.waiting.delete(worker)
                    this.send(res, 204)
                  }
                }, 20_000)
                res.on('close', () => clearTimeout(timer))
                return
              }
              case '/__bismith/result': {
                const b = (await this.body(req)) as { id: number; ok: boolean; result?: unknown; error?: string }
                const p = this.pending.get(b.id)
                if (p) {
                  this.pending.delete(b.id)
                  if (b.ok) p.resolve(b.result)
                  else p.reject(new Error(`${p.method}: ${b.error}`))
                }
                return this.send(res, 204)
              }
              case '/__bismith/hello': {
                const b = (await this.body(req)) as { renderer: string }
                this.ready.set(worker, b.renderer)
                this.readyWaiters.forEach((f) => f())
                return this.send(res, 204)
              }
              case '/__bismith/log': {
                const b = (await this.body(req)) as { level: string; text: string }
                if (this.logPage && !quietLog(b.text)) console.error(`[worker ${worker} ${b.level}]`, b.text)
                return this.send(res, 204)
              }
            }
            next()
          } catch (e) {
            this.send(res, 500, { error: String(e) })
          }
        })
      },
    }
  }
}

async function openWindowsSession(opts: SessionOptions): Promise<Session> {
  const browser = findWindowsBrowser()
  if (!browser) throw new Error('No Windows Chrome/Edge found (expected under C:\\Program Files)')
  const workers = Math.max(1, opts.workers ?? 1)
  const queue = new JobQueue()
  queue.logPage = opts.logPage ?? true
  const server: ViteDevServer = await createServer({
    root: ROOT,
    configFile: join(ROOT, 'vite.config.ts'),
    logLevel: 'error',
    plugins: [queue.plugin()],
    // Bind every interface so the Windows host reaches it through WSL's localhost forwarding.
    // No HMR / file watching: edits elsewhere must not reload pages mid-run.
    // BISMITH_PORT picks the first port to try: WSL's localhost forwarding to Windows sometimes sticks on a port, and the
    // browser then never reaches the page (only 0/N workers connect).
    server: { port: Number(process.env.BISMITH_PORT ?? 5290), strictPort: false, host: '0.0.0.0', hmr: false, watch: null },
  })
  await server.listen()
  const port = (server.httpServer?.address() as { port: number }).port
  const tag = `bismith-gpu-${port}`
  const temp = windowsTemp()
  const launch = (w: number) => {
    const args = [
      '--headless=new',
      `--user-data-dir=${temp}\\${tag}-${w}`,
      '--no-first-run',
      '--no-default-browser-check',
      '--disable-extensions',
      '--ignore-gpu-blocklist',
      // A shader that hangs the driver (TDR) would otherwise get the page's origin barred from WebGL.
      '--disable-domain-blocking-for-3d-apis',
      '--enable-gpu',
      `--use-angle=${opts.angle ?? process.env.BISMITH_ANGLE ?? 'd3d11'}`,
      ...((opts.angle ?? process.env.BISMITH_ANGLE) === 'vulkan' ? ['--enable-features=Vulkan'] : []),
      '--disable-background-timer-throttling',
      '--disable-renderer-backgrounding',
      '--disable-backgrounding-occluded-windows',
      `http://localhost:${port}/?headless&worker=${w}`,
    ]
    const list = args.map((a) => `'${a.replace(/'/g, "''")}'`).join(',')
    powershell(`Start-Process -FilePath '${browser.windows}' -ArgumentList ${list} -WindowStyle Hidden`)
  }
  // A browser left over from a crashed or killed run on the same port would swallow the launch (Chrome hands a
  // second start with the same profile to the running instance, keeping its old flags and possibly a hung GPU).
  killTagged(tag)
  await new Promise((r) => setTimeout(r, 750))
  for (let w = 0; w < workers; w++) launch(w)
  const cleanup = () => killTagged(tag)
  process.once('SIGINT', () => {
    cleanup()
    process.exit(130)
  })
  process.once('SIGTERM', () => {
    cleanup()
    process.exit(143)
  })
  try {
    await queue.whenReady(workers, 90_000)
  } catch (e) {
    cleanup()
    await server.close()
    throw e
  }
  let rr = 0
  const busy = new Array(workers).fill(0)
  const callOn = async <T>(worker: number, method: string, ...args: unknown[]): Promise<T> => {
    busy[worker]++
    try {
      return await queue.enqueue<T>(worker, method, args)
    } finally {
      busy[worker]--
    }
  }
  return {
    backend: 'windows',
    renderer: queue.ready.get(0) ?? 'unknown',
    workers,
    callOn,
    call<T>(method: string, ...args: unknown[]): Promise<T> {
      // Least-busy worker, round-robin among ties.
      let best = rr % workers
      for (let i = 0; i < workers; i++) {
        const w = (rr + i) % workers
        if (busy[w] < busy[best]) best = w
      }
      rr++
      return callOn<T>(best, method, ...args)
    },
    async close() {
      queue.failAll('session closed')
      cleanup()
      await server.close()
    },
  }
}

// ------------------------------------------------------------------------------------------------ swiftshader

async function openSwiftShaderSession(opts: SessionOptions): Promise<Session> {
  const workers = Math.max(1, opts.workers ?? 1)
  const server = await createServer({
    root: ROOT,
    configFile: join(ROOT, 'vite.config.ts'),
    logLevel: 'error',
    server: { port: 5190, strictPort: false, host: '127.0.0.1', hmr: false, watch: null },
  })
  await server.listen()
  const url = server.resolvedUrls?.local[0] ?? 'http://127.0.0.1:5190/'
  const browser: Browser = await chromium.launch({
    args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
    env: chromiumEnv(),
  })
  const pages: Page[] = []
  for (let w = 0; w < workers; w++) {
    const page = await browser.newPage()
    page.on('console', (msg) => {
      if ((opts.logPage ?? true) && (msg.type() === 'error' || msg.type() === 'warning') && !quietLog(msg.text())) {
        console.error(`[page ${msg.type()}]`, msg.text())
      }
    })
    page.on('pageerror', (err) => console.error('[page error]', err.message))
    await page.goto(url + '?headless')
    await page.waitForFunction(() => window.__bismith?.ready === true, null, { timeout: 60_000 })
    pages.push(page)
  }
  const renderer = await pages[0].evaluate(() => window.__bismith!.rendererInfo?.() ?? 'unknown')
  const callOn = <T>(worker: number, method: string, ...args: unknown[]): Promise<T> =>
    pages[worker].evaluate(
      ({ method, args }) => (window.__bismith as unknown as Record<string, (...a: unknown[]) => unknown>)[method](...args),
      { method, args },
    ) as Promise<T>
  let rr = 0
  return {
    backend: 'swiftshader',
    renderer,
    workers,
    callOn,
    call: <T>(method: string, ...args: unknown[]) => callOn<T>(rr++ % workers, method, ...args),
    async close() {
      await browser.close()
      await server.close()
    },
  }
}

/** Run a child process and stream its output (used by tools that shell out). */
export function run(cmd: string, args: string[]): Promise<number> {
  return new Promise((res) => spawn(cmd, args, { stdio: 'inherit' }).on('exit', (c) => res(c ?? 1)))
}
