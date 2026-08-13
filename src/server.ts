import handler, { createServerEntry } from '@tanstack/react-start/server-entry'
import {
  clearPlatformRuntime,
  handlePlatformRequest,
  preparePlatformRuntime,
  transformPlatformResponse,
} from './platform/backend'
import { handlePlatformAiRequest } from './platform/backend.server'

type RuntimeEnv = Record<string, unknown>
const BUSINESS_RUNTIME_SECRET_KEYS = new Set(['NUBASE_AI_GATEWAY_KEY'])

declare module '@tanstack/react-router' {
  interface Register {
    server: {
      requestContext: {
        env?: RuntimeEnv
      }
    }
  }
}

function renderServerError() {
  return new Response(
    '<!doctype html><html><head><title>Application error</title></head><body><h1>Application error</h1><p>The server failed to render this request.</p></body></html>',
    {
      status: 500,
      headers: {
        'content-type': 'text/html; charset=utf-8',
      },
    },
  )
}

function businessRuntimeEnv(env?: RuntimeEnv): RuntimeEnv | undefined {
  if (!env || ![...BUSINESS_RUNTIME_SECRET_KEYS].some((key) => key in env)) return env
  return Object.fromEntries(
    Object.entries(env).filter(([key]) => !BUSINESS_RUNTIME_SECRET_KEYS.has(key)),
  )
}

const serverEntry = createServerEntry({
  async fetch(request, env?: RuntimeEnv) {
    try {
      preparePlatformRuntime(request, env)

      const aiResponse = await handlePlatformAiRequest(request, env)
      if (aiResponse) return aiResponse

      const platformResponse = await handlePlatformRequest(request, env)
      if (platformResponse) return platformResponse

      const response = await handler.fetch(request, {
        context: {
          env: businessRuntimeEnv(env),
        },
      })
      return await transformPlatformResponse(response, request, env)
    } catch (error) {
      console.error('[server-entry] Unhandled render error', error)
      return renderServerError()
    } finally {
      clearPlatformRuntime()
    }
  },
})

// ESA Edge Routine entry: the platform routes non-asset requests to this
// handler and serves files from the routine `assets/` directory itself.
export default {
  async fetch(request: Request, env?: RuntimeEnv) {
    return serverEntry.fetch(request, env)
  },
}
