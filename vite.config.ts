import { defineConfig, type Plugin, type PluginOption, type ViteDevServer } from 'vite'
import react from '@vitejs/plugin-react'
import { build as esbuild } from 'esbuild'
import { spawn, type ChildProcess } from 'node:child_process'
import path from 'node:path'
import { createRequire } from 'node:module'
import { readFileSync } from 'node:fs'

// Resolve the real electron binary path (avoids the fragile .cmd shim which
// throws EINVAL on spawn in modern Node).
const requireFromHere = createRequire(import.meta.url)

const isElectronBuild = process.env.BUILD_TARGET === 'electron'
const isCapacitorBuild = process.env.BUILD_TARGET === 'capacitor'
const isPackagedNative = isElectronBuild || isCapacitorBuild

// Read package.json once at config load. Exposed to renderer code as the
// global __APP_VERSION__ so the UI can show the real shipping version.
const PKG_VERSION = (() => {
  try {
    const raw = readFileSync(path.join(process.cwd(), 'package.json'), 'utf-8')
    return String(JSON.parse(raw).version || '0.0.0')
  } catch {
    return '0.0.0'
  }
})()

// ----------------------------------------------------------------------------
// Electron build plugin
// ----------------------------------------------------------------------------
// Compiles electron/main.ts and electron/preload.ts to real CJS bundles via
// esbuild. In dev, launches Electron once Vite is listening and tears it down
// on server shutdown.
// ----------------------------------------------------------------------------
function electronPlugin(): Plugin {
  const ROOT = process.cwd()
  const OUT = path.join(ROOT, 'dist-electron')

  async function bundle(entry: string, outfile: string, external: string[]): Promise<void> {
    await esbuild({
      entryPoints: [path.join(ROOT, entry)],
      outfile: path.join(OUT, outfile),
      bundle: true,
      platform: 'node',
      target: 'node20',
      format: 'cjs',
      sourcemap: false,
      minify: false,
      logLevel: 'warning',
      external,
    })
  }

  async function bundleAll(): Promise<void> {
    // node: built-ins are automatically external on platform:'node'.
    // electron-window-state is CJS with native-ish deps — keep it external so
    // it stays in node_modules and gets picked up by electron-builder.
    await bundle('electron/main.ts', 'main.cjs', ['electron', 'electron-window-state'])
    await bundle('electron/preload.ts', 'preload.cjs', ['electron'])
  }

  let electronProc: ChildProcess | null = null
  let viteServer: ViteDevServer | null = null

  function launchElectron(): void {
    if (electronProc) {
      electronProc.removeAllListeners()
      electronProc.kill()
      electronProc = null
    }
    const electronBin = requireFromHere('electron') as unknown as string
    const addr = viteServer?.httpServer?.address()
    const port = typeof addr === 'object' && addr ? addr.port : 5173
    const devUrl = `http://localhost:${port}`

    electronProc = spawn(electronBin, [ROOT], {
      stdio: 'inherit',
      env: {
        ...process.env,
        VITE_DEV_SERVER_URL: devUrl,
        NODE_ENV: 'development',
      },
    })

    electronProc.on('close', () => {
      if (viteServer) viteServer.close().then(() => process.exit(0))
      else process.exit(0)
    })
  }

  return {
    name: 'arbeitskarte-electron',
    apply: () => isElectronBuild,

    // DEV: build once, launch Electron after Vite listens.
    async configureServer(server) {
      viteServer = server
      await bundleAll()
      server.httpServer?.once('listening', () => {
        setTimeout(launchElectron, 100)
      })
    },

    // BUILD: compile main/preload after Vite finishes the renderer bundle.
    async closeBundle() {
      if (!viteServer) {
        await bundleAll()
      }
    },
  }
}

export default defineConfig(() => {
  const plugins: PluginOption[] = [react()]
  if (isElectronBuild) plugins.push(electronPlugin())

  return {
    plugins,
    define: {
      __APP_VERSION__: JSON.stringify(PKG_VERSION),
    },
    // Electron loads index.html via file://; Capacitor serves dist/ from the
    // Android WebView asset bundle. Both need RELATIVE asset URLs (./assets/…)
    // — the default '/' resolves against the filesystem root in packaged
    // builds → ERR_FILE_NOT_FOUND. Web builds keep '/'.
    base: isPackagedNative ? './' : '/',
    build: {
      chunkSizeWarningLimit: 800,
      sourcemap: false,
    },
  }
})
