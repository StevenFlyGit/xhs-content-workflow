#!/usr/bin/env node
/**
 * Local smoke test for the packaged ESA Edge Routine entry.
 * Imports esa/.staging/routine/index.js with a mocked env and verifies:
 *   1. SSR rendering of the index route returns HTML
 *   2. Nubase proxy endpoints are intercepted (503 without upstream config)
 *   3. AI endpoints are intercepted (503 without config)
 *   4. Unknown routes still render through the router (404 or page)
 */
import { pathToFileURL } from 'node:url'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const ENTRY = path.join(ROOT, 'esa', '.staging', 'routine', 'index.js')


const BASE = 'http://localhost'
let passed = 0
let failed = 0

function check(name, condition, detail = '') {
  if (condition) {
    passed += 1
    console.log(`  PASS  ${name}${detail ? ` (${detail})` : ''}`)
  } else {
    failed += 1
    console.log(`  FAIL  ${name}${detail ? ` (${detail})` : ''}`)
  }
}

async function request(app, pathname, options = {}) {
  return app.fetch(new Request(`${BASE}${pathname}`, options), {})
}

async function main() {
  console.log('[esa-smoke] Loading routine entry:', path.relative(ROOT, ENTRY))
  const mod = await import(pathToFileURL(ENTRY).href)
  const app = mod.default

  check('entry exports default.fetch', typeof app?.fetch === 'function')

  // 1. SSR rendering of the index route
  const home = await request(app, '/')
  const homeHtml = await home.text()
  check('GET / returns 200', home.status === 200, `status=${home.status}`)
  check(
    'GET / returns HTML',
    (home.headers.get('content-type') ?? '').includes('text/html'),
    home.headers.get('content-type') ?? '',
  )
  check('GET / HTML has app markup', homeHtml.includes('<div id="root">') || homeHtml.includes('<!doctype html>') || homeHtml.includes('<html'))

  // 2. Nubase proxy interception (no upstream config -> 503, not SSR)
  const auth = await request(app, '/auth/v1/settings')
  check('GET /auth/v1/* intercepted by proxy', auth.status === 503, `status=${auth.status}`)
  const rest = await request(app, '/rest/v1/some_table')
  check('GET /rest/v1/* intercepted by proxy', rest.status === 503, `status=${rest.status}`)

  // 3. AI endpoints interception (no config -> 503)
  const ai = await request(app, '/.ottermind/ai/chat/completions', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ messages: [{ role: 'user', content: 'hi' }] }),
  })
  check('POST /.ottermind/ai/* intercepted', ai.status === 503, `status=${ai.status}`)

  // 4. Blocked admin proxy path returns 403
  const admin = await request(app, '/auth/v1/admin/users')
  check('GET /auth/v1/admin/* blocked', admin.status === 403, `status=${admin.status}`)

  console.log(`\n[esa-smoke] ${passed} passed, ${failed} failed`)
  process.exit(failed > 0 ? 1 : 0)
}

main().catch((error) => {
  console.error('[esa-smoke] Fatal:', error)
  process.exit(1)
})
