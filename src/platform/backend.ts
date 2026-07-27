import { attachNubaseAuth } from '../integrations/nubase/auth-attacher'
import {
  getNubasePublicConfigFromEnv,
  getNubaseServerConfigFromEnv,
  type NubaseServerConfig,
  renderNubaseRuntimeConfigScript,
  setNubaseRuntimePublicConfig,
  setNubaseRuntimeServerConfig,
} from '../integrations/nubase/config'

type RuntimeEnv = Record<string, unknown>
const AI_MEDIA_BUCKET = 'ottermind-ai-media'
const AI_MEDIA_SIGN_PATH = `/storage/v1/object/sign/${AI_MEDIA_BUCKET}`
const AI_JOBS_TABLE = 'ottermind_ai_jobs'
const STORAGE_BODY_BUCKET_PATHS = new Set([
  '/storage/v1/bucket',
  '/storage/v1/object/move',
  '/storage/v1/object/copy',
])

export const platformFunctionMiddleware = [attachNubaseAuth]

function requestOrigin(request: Request) {
  const url = new URL(request.url)
  return url.origin
}

function isHtmlResponse(response: Response) {
  return response.headers.get('content-type')?.includes('text/html')
}

async function injectNubaseRuntimeConfig(
  response: Response,
  request: Request,
  env?: RuntimeEnv,
) {
  if (!isHtmlResponse(response)) return response

  const script = renderNubaseRuntimeConfigScript(
    getNubasePublicConfigFromEnv(env, requestOrigin(request)),
  )
  if (!script) return response

  const html = await response.text()
  const injected = html.includes('</head>')
    ? html.replace('</head>', `${script}</head>`)
    : `${script}${html}`
  const headers = new Headers(response.headers)
  headers.delete('content-length')

  return new Response(injected, {
    status: response.status,
    statusText: response.statusText,
    headers,
  })
}

function isBlockedNubaseProxyPath(pathname: string) {
  return pathname === '/auth/v1/admin'
    || pathname.startsWith('/auth/v1/admin/')
    || pathname === '/deployments/admin'
    || pathname.startsWith('/deployments/admin/')
    || pathname === '/mcp'
    || pathname.startsWith('/mcp/')
}

function canonicalPathSegment(segment: string) {
  try {
    return decodeURIComponent(segment).split(/[;/]/, 1)[0] ?? ''
  } catch {
    return null
  }
}

function pathnameTargetsAiMediaBucket(pathname: string) {
  return pathname.split('/').some((segment) => canonicalPathSegment(segment) === AI_MEDIA_BUCKET)
}

function pathnameTargetsAiJobsTable(pathname: string) {
  const segments = pathname.split('/')
  if (segments.length < 4) return false
  return canonicalPathSegment(segments[1] ?? '') === 'rest'
    && canonicalPathSegment(segments[2] ?? '') === 'v1'
    && canonicalPathSegment(segments[3] ?? '') === AI_JOBS_TABLE
}

async function bodyTargetsAiMediaBucket(request: Request, pathname: string) {
  if (request.method !== 'POST' || !STORAGE_BODY_BUCKET_PATHS.has(pathname)) return false
  const declaredLength = Number(request.headers.get('content-length'))
  if (Number.isFinite(declaredLength) && declaredLength > 64 * 1024) return true
  try {
    const payload = await request.clone().json() as Record<string, unknown>
    return payload.id === AI_MEDIA_BUCKET
      || payload.name === AI_MEDIA_BUCKET
      || payload.bucketId === AI_MEDIA_BUCKET
      || payload.destinationBucket === AI_MEDIA_BUCKET
  } catch {
    return false
  }
}

async function isBlockedNubaseProxyRequest(request: Request, url: URL) {
  if (isBlockedNubaseProxyPath(url.pathname)) return true
  if (pathnameTargetsAiJobsTable(url.pathname)) return true
  const isAiMediaSignPath = url.pathname === AI_MEDIA_SIGN_PATH
    || url.pathname.startsWith(`${AI_MEDIA_SIGN_PATH}/`)
  if (isAiMediaSignPath) {
    const isSignedRead = (request.method === 'GET' || request.method === 'HEAD')
      && Boolean(url.searchParams.get('token'))
    return !isSignedRead
  }
  if (pathnameTargetsAiMediaBucket(url.pathname)) return true
  return bodyTargetsAiMediaBucket(request, url.pathname)
}

function isNubaseProxyPath(pathname: string) {
  return pathname === '/auth/v1'
    || pathname.startsWith('/auth/v1/')
    || pathname === '/rest/v1'
    || pathname.startsWith('/rest/v1/')
    || pathname === '/storage/v1'
    || pathname.startsWith('/storage/v1/')
}

function copyProxyRequestHeaders(
  requestHeaders: Headers,
  config: NubaseServerConfig,
  incomingUrl: URL,
  upstreamUrl: URL,
) {
  const headers = new Headers()
  for (const [key, value] of requestHeaders) {
    const lowerKey = key.toLowerCase()
    if (
      lowerKey === 'host'
      || lowerKey === 'cookie'
      || lowerKey === 'content-length'
      || lowerKey === 'connection'
      || lowerKey === 'origin'
      || lowerKey === 'referer'
      || lowerKey === 'apikey'
      || lowerKey === 'x-nubase-project-ref'
      || lowerKey.startsWith('cf-')
      || lowerKey.startsWith('x-forwarded-')
      || lowerKey.startsWith('x-real-ip')
    ) {
      continue
    }
    headers.set(key, value)
  }

  headers.set('x-forwarded-proto', incomingUrl.protocol.replace(/:$/, ''))
  headers.set('x-forwarded-host', upstreamUrl.hostname)
  headers.set(
    'x-forwarded-port',
    upstreamUrl.port || (upstreamUrl.protocol === 'https:' ? '443' : '80'),
  )
  headers.set('apikey', config.publishableKey)
  const projectRef = projectRefForConfig(config)
  if (projectRef) {
    headers.set('x-nubase-project-ref', projectRef)
  }

  return headers
}

function projectRefForConfig(config: NubaseServerConfig) {
  return projectRefFromJwt(config.publishableKey) ?? config.projectRef
}

function projectRefFromJwt(token: string) {
  const parts = token.split('.')
  if (parts.length !== 3 || !parts[1]) return undefined
  try {
    const base64 = parts[1].replace(/-/g, '+').replace(/_/g, '/')
    const paddedBase64 = base64.padEnd(base64.length + ((4 - base64.length % 4) % 4), '=')
    const payload = JSON.parse(atob(paddedBase64)) as {
      ref?: unknown
    }
    return typeof payload.ref === 'string' && payload.ref.trim()
      ? payload.ref.trim()
      : undefined
  } catch {
    return undefined
  }
}

function applyProjectScopedProxyParams(
  upstreamUrl: URL,
  incomingUrl: URL,
  config: NubaseServerConfig,
) {
  if (incomingUrl.pathname !== '/auth/v1/authorize') return

  const projectRef = projectRefForConfig(config)
  if (!projectRef) return

  // Nubase authorize resolves the tenant from app_code/domain before apikey.
  // Generated apps proxy through a shared upstream domain, so force the current
  // app project ref instead of trusting browser-supplied query params.
  upstreamUrl.searchParams.set('app_code', projectRef)
}

function isNubaseOAuthAuthorizePath(pathname: string) {
  return pathname === '/auth/v1/authorize'
    || pathname === '/auth/v1/user/identities/authorize'
}

function upstreamBaseUrlForRequest(config: NubaseServerConfig, incomingUrl: URL) {
  return isNubaseOAuthAuthorizePath(incomingUrl.pathname) && config.authUrl
    ? config.authUrl
    : config.upstreamUrl
}

function copyProxyResponseHeaders(responseHeaders: Headers) {
  const headers = new Headers()
  for (const [key, value] of responseHeaders) {
    const lowerKey = key.toLowerCase()
    if (
      lowerKey === 'connection'
      || lowerKey === 'transfer-encoding'
      || lowerKey === 'content-length'
    ) {
      continue
    }
    headers.set(key, value)
  }
  return headers
}

async function proxyNubaseRequest(
  request: Request,
  config: NubaseServerConfig | undefined,
) {
  const incomingUrl = new URL(request.url)
  if (await isBlockedNubaseProxyRequest(request, incomingUrl)) {
    return new Response('Forbidden Nubase proxy path', { status: 403 })
  }
  if (!isNubaseProxyPath(incomingUrl.pathname)) return undefined

  if (!config) {
    return new Response('Missing Nubase upstream proxy config', { status: 503 })
  }

  const upstreamUrl = new URL(upstreamBaseUrlForRequest(config, incomingUrl))
  upstreamUrl.pathname = incomingUrl.pathname
  upstreamUrl.search = incomingUrl.search
  applyProjectScopedProxyParams(upstreamUrl, incomingUrl, config)

  const init: RequestInit = {
    method: request.method,
    headers: copyProxyRequestHeaders(request.headers, config, incomingUrl, upstreamUrl),
    redirect: 'manual',
  }
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    init.body = request.body
  }

  const upstreamResponse = await fetch(upstreamUrl, init)
  return new Response(upstreamResponse.body, {
    status: upstreamResponse.status,
    statusText: upstreamResponse.statusText,
    headers: copyProxyResponseHeaders(upstreamResponse.headers),
  })
}

export function preparePlatformRuntime(request: Request, env?: RuntimeEnv) {
  const nubaseConfig = getNubasePublicConfigFromEnv(env, requestOrigin(request))
  const nubaseServerConfig = getNubaseServerConfigFromEnv(env, nubaseConfig)
  setNubaseRuntimePublicConfig(nubaseConfig)
  setNubaseRuntimeServerConfig(nubaseServerConfig
    ? { ...nubaseServerConfig, aiGatewayKey: undefined }
    : undefined)
}

export async function handlePlatformRequest(
  request: Request,
  env?: RuntimeEnv,
): Promise<Response | undefined> {
  const nubaseConfig = getNubasePublicConfigFromEnv(env, requestOrigin(request))
  const nubaseServerConfig = getNubaseServerConfigFromEnv(env, nubaseConfig)
  return proxyNubaseRequest(request, nubaseServerConfig)
}

export async function transformPlatformResponse(
  response: Response,
  request: Request,
  env?: RuntimeEnv,
): Promise<Response> {
  return injectNubaseRuntimeConfig(response, request, env)
}

export function clearPlatformRuntime() {
  setNubaseRuntimePublicConfig(undefined)
  setNubaseRuntimeServerConfig(undefined)
}
