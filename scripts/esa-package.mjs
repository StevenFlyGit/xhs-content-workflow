#!/usr/bin/env node
/**
 * Packages the Vite build output into an ESA Edge Routine JS_AND_ASSETS zip:
 *
 *   routine/index.js   <- single-file bundle of the SSR server output
 *   assets/            <- client build artifacts (dist/client)
 *
 * ESA Edge Routine loads ONLY the routine/index.js entry file (relative
 * imports to sibling files fail at runtime), so the SSR bundle is re-bundled
 * into one file with esbuild. Node builtins stay external and require the
 * routine's Node.js compatibility mode.
 *
 * Usage: node scripts/esa-package.mjs [routineName]
 * Output: esa/<routineName>.zip
 */
import { createWriteStream, existsSync } from 'node:fs'
import { cp, mkdir, readdir, rm, stat, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import JSZip from 'jszip'
import { build } from 'esbuild'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const DIST_CLIENT = path.join(ROOT, 'dist', 'client')
const DIST_SERVER = path.join(ROOT, 'dist', 'server')
const SERVER_ENTRY = path.join(DIST_SERVER, 'server.js')
const STAGING_DIR = path.join(ROOT, 'esa', '.staging')
const ROUTINE_NAME = process.argv[2] || 'xhs-content-workflow'
// TEMP diagnostics: `node scripts/esa-package.mjs [name] --diag` wraps the
// handler to surface edge errors as response bodies.
const DIAG_MODE = process.argv.includes('--diag')
const OUTPUT_ZIP = path.join(ROOT, 'esa', `${ROUTINE_NAME}.zip`)

const EXCLUDED_SERVER_FILES = new Set(['.dev.vars', 'wrangler.json', 'wrangler.jsonc'])

async function ensureDir(dir) {
  await mkdir(dir, { recursive: true })
}

async function assertBuildOutput() {
  const missing = []
  // SSR apps render HTML on the server, so the client output only carries
  // hashed assets + public files — require either index.html or assets/.
  if (
    !existsSync(path.join(DIST_CLIENT, 'index.html'))
    && !existsSync(path.join(DIST_CLIENT, 'assets'))
  ) {
    missing.push(DIST_CLIENT)
  }
  if (!existsSync(SERVER_ENTRY)) missing.push(SERVER_ENTRY)
  if (missing.length > 0) {
    console.error('[esa-package] Missing build output:', missing.join(', '))
    console.error('[esa-package] Run `bun run build` (vite build) before packaging.')
    process.exit(1)
  }
}

async function stageRoutine() {
  const routineDir = path.join(STAGING_DIR, 'routine')
  await ensureDir(routineDir)

  // ESA Edge Routine loads only routine/index.js — re-bundle the SSR output
  // (server.js + shared chunks + dynamic route chunks) into that single file.
  // ESA rejects the `node:` module scheme, so every node:* import the bundle
  // carries is aliased to an edge-safe shim (see scripts/esa-node-shims.mjs).
  const shims = path.join(ROOT, 'scripts', 'esa-node-shims.mjs')
  let banner = await readFile(path.join(ROOT, 'scripts', 'esa-process-banner.js'), 'utf8')
  if (DIAG_MODE) {
    banner += [
      '',
      'var __esa_console_errors__ = []',
      'var __esa_orig_console_error__ = console.error',
      'console.error = function () {',
      '  try {',
      '    var parts = []',
      '    for (var i = 0; i < arguments.length; i++) {',
      '      var a = arguments[i]',
      '      if (a && a.stack) parts.push(String(a.message || a) + " | " + String(a.stack).slice(0, 1200))',
      '      else { try { parts.push(typeof a === "string" ? a : JSON.stringify(a)) } catch (e) { parts.push(String(a)) } }',
      '    }',
      '    __esa_console_errors__.push(parts.join(" ;; ").slice(0, 1800))',
      '    if (__esa_console_errors__.length > 20) __esa_console_errors__.shift()',
      '  } catch (e) {}',
      '  __esa_orig_console_error__.apply(console, arguments)',
      '}',
      '',
    ].join('\n')
  }
  await build({
    entryPoints: [SERVER_ENTRY],
    outfile: path.join(routineDir, 'index.js'),
    bundle: true,
    format: 'esm',
    platform: 'neutral',
    target: 'es2022',
    alias: {
      'node:module': shims,
      'node:stream': shims,
      'node:stream/web': shims,
      'node:async_hooks': shims,
    },
    banner: { js: banner },
    define: { 'process.env.NODE_ENV': '"production"' },
    logLevel: 'warning',
  })

  if (DIAG_MODE) {
    // Post-process: swap the default export binding for an error-capturing
    // wrapper defined at the end of the file (live bindings make this safe).
    const entryPath = path.join(routineDir, 'index.js')
    const code = await readFile(entryPath, 'utf8')
    const idx = code.lastIndexOf('export {')
    if (idx < 0) throw new Error('[esa-package] diag: export statement not found')
    const exportEnd = code.indexOf('}', idx)
    const exportStmt = code.slice(idx, exportEnd + 1)
    const m = exportStmt.match(/([A-Za-z_$][\w$]*) as default/)
    if (!m) throw new Error('[esa-package] diag: default export binding not found')
    const inner = m[1]
    const patchedExport = exportStmt.replace(`${inner} as default`, '__esa_wrapped__ as default')
    const wrapper = [
      '',
      `const __esa_inner__ = ${inner}`,
      'const __esa_errors__ = []',
      'try {',
      '  self.addEventListener("error", (event) => {',
      '    __esa_errors__.push("event:" + String(event?.message || event?.error?.message || "unknown") + " | " + String(event?.error?.stack || "").slice(0, 800))',
      '  })',
      '  self.addEventListener("unhandledrejection", (event) => {',
      '    const reason = event?.reason',
      '    __esa_errors__.push("rejection:" + String(reason?.message || reason) + " | " + String(reason?.stack || "").slice(0, 800))',
      '  })',
      '} catch {}',
      'const __esa_wrapped__ = {',
      '  async fetch(request, env) {',
      '    const url = new URL(request.url)',
      '    if (url.pathname === "/__esa_diag_canary") {',
      '      return new Response("canary-ok | collected=" + JSON.stringify(__esa_errors__), { status: 200 })',
      '    }',
      '    try {',
      '      const response = await __esa_inner__.fetch(request, env)',
      '      const body = await response.text()',
      '      const headers = new Headers(response.headers)',
      '      headers.delete("content-length")',
      '      if (response.status >= 500) {',
      '        headers.set("x-esa-diag-collected", encodeURIComponent(JSON.stringify({ errors: __esa_errors__, console: (typeof __esa_console_errors__ !== "undefined" ? __esa_console_errors__ : []) }).slice(0, 3500)))',
      '      }',
      '      return new Response(body, { status: response.status, statusText: response.statusText, headers })',
      '    } catch (error) {',
      '      const detail = [error?.name, error?.message, error?.stack, "collected=" + JSON.stringify(__esa_errors__)].filter(Boolean).join(" | ")',
      '      return new Response("ESA-DIAG: " + detail, { status: 599, headers: { "content-type": "text/plain; charset=utf-8" } })',
      '    }',
      '  },',
      '}',
      '',
    ].join('\n')
    const patched = code.slice(0, idx) + patchedExport + code.slice(exportEnd + 1) + wrapper
    await writeFile(entryPath, patched)
    console.log('[esa-package] diag wrapper applied (inner binding:', inner + ')')
  }
}

async function stageClientAssets() {
  const assetsDir = path.join(STAGING_DIR, 'assets')
  await ensureDir(assetsDir)
  const entries = await readdir(DIST_CLIENT, { withFileTypes: true })
  for (const entry of entries) {
    if (entry.name.startsWith('.') || EXCLUDED_SERVER_FILES.has(entry.name)) continue
    await cp(
      path.join(DIST_CLIENT, entry.name),
      path.join(assetsDir, entry.name),
      { recursive: entry.isDirectory() },
    )
  }
}

async function totalSize(dir) {
  let total = 0
  const entries = await readdir(dir, { withFileTypes: true, recursive: true })
  for (const entry of entries) {
    if (!entry.isFile()) continue
    const fileStat = await stat(path.join(entry.parentPath ?? entry.path, entry.name))
    total += fileStat.size
  }
  return total
}

async function zipStaging() {
  const zip = new JSZip()
  const entries = await readdir(STAGING_DIR, { withFileTypes: true, recursive: true })
  for (const entry of entries) {
    if (!entry.isFile()) continue
    const absolute = path.join(entry.parentPath ?? entry.path, entry.name)
    const relative = path.relative(STAGING_DIR, absolute).split(path.sep).join('/')
    zip.file(relative, await readFile(absolute))
  }
  await ensureDir(path.dirname(OUTPUT_ZIP))
  const buffer = await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' })
  await new Promise((resolve, reject) => {
    const stream = createWriteStream(OUTPUT_ZIP)
    stream.on('finish', resolve)
    stream.on('error', reject)
    stream.end(buffer)
  })
  return buffer.byteLength
}

async function main() {
  await assertBuildOutput()
  if (existsSync(STAGING_DIR)) await rm(STAGING_DIR, { recursive: true, force: true })

  await stageRoutine()
  await stageClientAssets()

  const routineSize = await totalSize(path.join(STAGING_DIR, 'routine'))
  const assetsSize = await totalSize(path.join(STAGING_DIR, 'assets'))
  const zipSize = await zipStaging()

  const mb = (bytes) => `${(bytes / (1024 * 1024)).toFixed(2)} MB`
  console.log('[esa-package] Routine name      :', ROUTINE_NAME)
  console.log('[esa-package] routine/ size     :', mb(routineSize), routineSize > 5 * 1024 * 1024 ? '(WARNING: > 5MB ER limit)' : '(within 5MB ER limit)')
  console.log('[esa-package] assets/ size      :', mb(assetsSize))
  console.log('[esa-package] Zip package       :', path.relative(ROOT, OUTPUT_ZIP), `(${mb(zipSize)})`)
  console.log('[esa-package] Staging preserved :', path.relative(ROOT, STAGING_DIR))
}

main().catch((error) => {
  console.error('[esa-package] Failed:', error)
  process.exit(1)
})
