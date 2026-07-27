import type {
  NubaseAiChatCompletion,
  NubaseAiImageJob,
  NubaseAiMediaJob,
  NubaseAiVideoJob,
} from './ai-client'
import type { NubaseServerConfig } from './config'

const AI_ROUTE_PREFIX = '/.ottermind/ai'
const CHAT_MODEL = 'deepseek-v4-pro'
const IMAGE_MODEL = 'gpt-image-2'
const VIDEO_MODEL = 'bytedance/doubao-seedance-2.0'
const MEDIA_BUCKET = 'ottermind-ai-media'
const SIGNED_URL_TTL_SECONDS = 3_600
const VIDEO_RETRY_AFTER_MS = 10_000
const MAX_REQUEST_BYTES = 128 * 1024
const MAX_SMALL_JSON_BYTES = 1024 * 1024
const MAX_IMAGE_JSON_BYTES = 12 * 1024 * 1024
const MAX_VIDEO_JSON_BYTES = 12 * 1024 * 1024
const MAX_BASE64_MEDIA_BYTES = 8 * 1024 * 1024
const MAX_STREAMED_VIDEO_BYTES = 100 * 1024 * 1024
const BASE64_DECODE_CHUNK_CHARS = 64 * 1024

type JsonRecord = Record<string, unknown>

interface AuthenticatedUser {
  id: string
  accessToken: string
}

interface AiJobRow {
  id: string
  user_id: string
  kind: 'image' | 'video'
  status: 'pending' | 'processing' | 'succeeded' | 'failed'
  model: string
  request_json: JsonRecord
  result_json?: JsonRecord | null
  operation_name?: string | null
  upstream?: string | null
  storage_bucket?: string | null
  storage_path?: string | null
  storage_mime_type?: string | null
  error_code?: string | null
  error_message?: string | null
  last_polled_at?: string | null
  created_at: string
  updated_at: string
  completed_at?: string | null
}

function isAiJobRow(value: unknown): value is AiJobRow {
  if (!isRecord(value)) return false
  const optionalString = (child: unknown) => (
    child === undefined || child === null || typeof child === 'string'
  )
  return typeof value.id === 'string'
    && typeof value.user_id === 'string'
    && (value.kind === 'image' || value.kind === 'video')
    && ['pending', 'processing', 'succeeded', 'failed'].includes(String(value.status))
    && typeof value.model === 'string'
    && isRecord(value.request_json)
    && (value.result_json === undefined || value.result_json === null || isRecord(value.result_json))
    && optionalString(value.operation_name)
    && optionalString(value.upstream)
    && optionalString(value.storage_bucket)
    && optionalString(value.storage_path)
    && optionalString(value.storage_mime_type)
    && optionalString(value.error_code)
    && optionalString(value.error_message)
    && optionalString(value.last_polled_at)
    && typeof value.created_at === 'string'
    && typeof value.updated_at === 'string'
    && optionalString(value.completed_at)
}

class AiHttpError extends Error {
  readonly status: number
  readonly code: string
  readonly retryable: boolean

  constructor(status: number, code: string, message: string, retryable = false) {
    super(message)
    this.name = 'AiHttpError'
    this.status = status
    this.code = code
    this.retryable = retryable
  }
}

function isRecord(value: unknown): value is JsonRecord {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function jsonResponse(value: unknown, status = 200, extraHeaders?: HeadersInit) {
  const headers = new Headers(extraHeaders)
  headers.set('content-type', 'application/json; charset=utf-8')
  headers.set('cache-control', 'no-store')
  return new Response(JSON.stringify(value), { status, headers })
}

function errorResponse(error: AiHttpError) {
  return jsonResponse({
    error: {
      code: error.code,
      message: error.message,
      retryable: error.retryable,
    },
  }, error.status)
}

async function discardBody(response: Response) {
  if (!response.body) return
  await response.body.cancel().catch(() => undefined)
}

function withHeaders(response: Response, values: HeadersInit) {
  const headers = new Headers(response.headers)
  const additions = new Headers(values)
  for (const [key, value] of additions) headers.set(key, value)
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  })
}

function methodNotAllowedResponse(allowed: string) {
  return withHeaders(
    errorResponse(new AiHttpError(405, 'AI_METHOD_NOT_ALLOWED', 'Method not allowed.')),
    { Allow: allowed },
  )
}

async function readBoundedBytes(
  body: ReadableStream<Uint8Array> | null,
  maxBytes: number,
  tooLargeCode: string,
): Promise<Uint8Array> {
  if (!body) return new Uint8Array()
  const reader = body.getReader()
  const chunks: Uint8Array[] = []
  let total = 0
  try {
    while (true) {
      const next = await reader.read()
      if (next.done) break
      total += next.value.byteLength
      if (total > maxBytes) {
        await reader.cancel('body too large')
        throw new AiHttpError(413, tooLargeCode, 'Payload exceeds the allowed size.')
      }
      chunks.push(next.value)
    }
  } finally {
    reader.releaseLock()
  }
  const output = new Uint8Array(total)
  let offset = 0
  for (const chunk of chunks) {
    output.set(chunk, offset)
    offset += chunk.byteLength
  }
  return output
}

async function readBoundedJson(
  input: Request | Response,
  maxBytes: number,
  invalidCode: string,
): Promise<unknown> {
  const declaredLength = Number(input.headers.get('content-length'))
  if (Number.isFinite(declaredLength) && declaredLength > maxBytes) {
    throw new AiHttpError(413, `${invalidCode}_TOO_LARGE`, 'Payload exceeds the allowed size.')
  }
  const bytes = await readBoundedBytes(input.body, maxBytes, `${invalidCode}_TOO_LARGE`)
  try {
    return JSON.parse(new TextDecoder().decode(bytes)) as unknown
  } catch {
    throw new AiHttpError(
      input instanceof Request ? 400 : 502,
      invalidCode,
      input instanceof Request
        ? 'Request body must be valid JSON.'
        : 'The upstream service returned invalid JSON.',
    )
  }
}

function requiredString(value: unknown, field: string, maxLength: number) {
  if (typeof value !== 'string' || !value.trim()) {
    throw new AiHttpError(400, 'AI_INVALID_REQUEST', `${field} is required.`)
  }
  const normalized = value.trim()
  if (normalized.length > maxLength) {
    throw new AiHttpError(400, 'AI_INVALID_REQUEST', `${field} is too long.`)
  }
  return normalized
}

function optionalNumber(
  value: unknown,
  field: string,
  defaultValue: number,
  min: number,
  max: number,
) {
  if (value === undefined) return defaultValue
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max) {
    throw new AiHttpError(400, 'AI_INVALID_REQUEST', `${field} is invalid.`)
  }
  return value
}

function oneOf<T extends string>(
  value: unknown,
  field: string,
  allowed: readonly T[],
  fallback: T,
): T {
  if (value === undefined) return fallback
  if (typeof value !== 'string' || !allowed.includes(value as T)) {
    throw new AiHttpError(400, 'AI_INVALID_REQUEST', `${field} is invalid.`)
  }
  return value as T
}

function bearerToken(request: Request) {
  const match = request.headers.get('authorization')?.match(/^Bearer\s+(.+)$/i)
  return match?.[1]?.trim() || null
}

function projectHeaders(config: NubaseServerConfig, accessToken: string, json = false) {
  const headers = new Headers({
    apikey: config.publishableKey,
    authorization: `Bearer ${accessToken}`,
  })
  if (config.projectRef) headers.set('x-nubase-project-ref', config.projectRef)
  if (json) headers.set('content-type', 'application/json')
  return headers
}

function gatewayHeaders(config: NubaseServerConfig) {
  if (!config.aiGatewayKey) {
    throw new AiHttpError(503, 'AI_NOT_CONFIGURED', 'AI is not configured for this app.')
  }
  return new Headers({
    authorization: `Bearer ${config.aiGatewayKey}`,
    'content-type': 'application/json',
  })
}

function upstreamUrl(config: NubaseServerConfig, path: string) {
  return `${config.upstreamUrl.replace(/\/+$/, '')}${path}`
}

async function authenticatedUser(request: Request, config: NubaseServerConfig) {
  const accessToken = bearerToken(request)
  if (!accessToken) {
    throw new AiHttpError(401, 'AI_AUTH_REQUIRED', 'Sign in before using AI features.')
  }

  let response: Response
  try {
    response = await fetch(upstreamUrl(config, '/auth/v1/user'), {
      method: 'GET',
      headers: projectHeaders(config, accessToken),
    })
  } catch {
    throw new AiHttpError(503, 'AI_AUTH_UNAVAILABLE', 'Authentication is temporarily unavailable.', true)
  }
  if (!response.ok) {
    await discardBody(response)
    throw new AiHttpError(401, 'AI_AUTH_REQUIRED', 'Your session is invalid or expired.')
  }
  const payload = await readBoundedJson(response, MAX_SMALL_JSON_BYTES, 'AI_AUTH_INVALID_RESPONSE')
  const user = isRecord(payload) && isRecord(payload.user) ? payload.user : payload
  const id = isRecord(user) && typeof user.id === 'string' ? user.id : null
  if (!id) {
    throw new AiHttpError(401, 'AI_AUTH_REQUIRED', 'Your session is invalid or expired.')
  }
  return { id, accessToken } satisfies AuthenticatedUser
}

function restEndpoint(config: NubaseServerConfig, search = '') {
  return upstreamUrl(config, `/rest/v1/ottermind_ai_jobs${search}`)
}

async function readJobRows(response: Response): Promise<AiJobRow[]> {
  if (!response.ok) {
    await discardBody(response)
    throw new AiHttpError(502, 'AI_JOB_STORE_FAILED', 'AI job storage is unavailable.', response.status >= 500)
  }
  const payload = await readBoundedJson(response, MAX_SMALL_JSON_BYTES, 'AI_JOB_STORE_INVALID_RESPONSE')
  if (!Array.isArray(payload)) {
    throw new AiHttpError(502, 'AI_JOB_STORE_INVALID_RESPONSE', 'AI job storage returned invalid data.')
  }
  const rows = payload.filter(isAiJobRow)
  if (rows.length !== payload.length) {
    throw new AiHttpError(502, 'AI_JOB_STORE_INVALID_RESPONSE', 'AI job storage returned invalid data.')
  }
  return rows
}

async function insertJob(
  config: NubaseServerConfig,
  user: AuthenticatedUser,
  value: JsonRecord,
) {
  const headers = projectHeaders(config, user.accessToken, true)
  headers.set('prefer', 'return=representation')
  const response = await fetch(restEndpoint(config), {
    method: 'POST',
    headers,
    body: JSON.stringify({ user_id: user.id, ...value }),
  })
  const [row] = await readJobRows(response)
  if (!row) throw new AiHttpError(502, 'AI_JOB_STORE_FAILED', 'AI job could not be created.')
  return row
}

async function updateJob(
  config: NubaseServerConfig,
  user: AuthenticatedUser,
  id: string,
  patch: JsonRecord,
) {
  const query = new URLSearchParams({
    id: `eq.${id}`,
    user_id: `eq.${user.id}`,
  })
  const headers = projectHeaders(config, user.accessToken, true)
  headers.set('prefer', 'return=representation')
  const response = await fetch(restEndpoint(config, `?${query.toString()}`), {
    method: 'PATCH',
    headers,
    body: JSON.stringify({ ...patch, updated_at: new Date().toISOString() }),
  })
  const [row] = await readJobRows(response)
  if (!row) throw new AiHttpError(404, 'AI_JOB_NOT_FOUND', 'AI job was not found.')
  return row
}

async function updateClaimedVideoJob(
  config: NubaseServerConfig,
  user: AuthenticatedUser,
  claimed: AiJobRow,
  patch: JsonRecord,
) {
  if (!claimed.last_polled_at) {
    throw new AiHttpError(502, 'AI_JOB_STORE_INVALID_RESPONSE', 'AI job storage returned an invalid poll claim.')
  }
  const query = new URLSearchParams({
    id: `eq.${claimed.id}`,
    user_id: `eq.${user.id}`,
    status: 'in.(pending,processing)',
    last_polled_at: `eq.${claimed.last_polled_at}`,
  })
  const headers = projectHeaders(config, user.accessToken, true)
  headers.set('prefer', 'return=representation')
  const response = await fetch(restEndpoint(config, `?${query.toString()}`), {
    method: 'PATCH',
    headers,
    body: JSON.stringify({ ...patch, updated_at: new Date().toISOString() }),
  })
  const rows = await readJobRows(response)
  return rows[0] ?? null
}

async function updateClaimedVideoJobOrLatest(
  config: NubaseServerConfig,
  user: AuthenticatedUser,
  claimed: AiJobRow,
  patch: JsonRecord,
) {
  return await updateClaimedVideoJob(config, user, claimed, patch)
    ?? findJob(config, user, claimed.id)
}

async function claimVideoPoll(
  config: NubaseServerConfig,
  user: AuthenticatedUser,
  id: string,
) {
  const cutoff = new Date(Date.now() - VIDEO_RETRY_AFTER_MS).toISOString()
  const query = new URLSearchParams({
    id: `eq.${id}`,
    user_id: `eq.${user.id}`,
    status: 'in.(pending,processing)',
    or: `(last_polled_at.is.null,last_polled_at.lt.${cutoff})`,
  })
  const headers = projectHeaders(config, user.accessToken, true)
  headers.set('prefer', 'return=representation')
  const response = await fetch(restEndpoint(config, `?${query.toString()}`), {
    method: 'PATCH',
    headers,
    body: JSON.stringify({
      status: 'processing',
      last_polled_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }),
  })
  const rows = await readJobRows(response)
  return rows[0] ?? null
}

async function findJob(
  config: NubaseServerConfig,
  user: AuthenticatedUser,
  id: string,
) {
  const query = new URLSearchParams({
    id: `eq.${id}`,
    user_id: `eq.${user.id}`,
    select: '*',
    limit: '1',
  })
  const response = await fetch(restEndpoint(config, `?${query.toString()}`), {
    headers: projectHeaders(config, user.accessToken),
  })
  const [row] = await readJobRows(response)
  if (!row) throw new AiHttpError(404, 'AI_JOB_NOT_FOUND', 'AI job was not found.')
  return row
}

async function listVideoJobs(config: NubaseServerConfig, user: AuthenticatedUser) {
  const query = new URLSearchParams({
    kind: 'eq.video',
    user_id: `eq.${user.id}`,
    select: '*',
    order: 'created_at.desc',
    limit: '50',
  })
  const response = await fetch(restEndpoint(config, `?${query.toString()}`), {
    headers: projectHeaders(config, user.accessToken),
  })
  return readJobRows(response)
}

function encodeStoragePath(path: string) {
  return path.split('/').map(encodeURIComponent).join('/')
}

function extensionForMimeType(mimeType: string) {
  if (mimeType === 'image/jpeg') return 'jpg'
  if (mimeType === 'image/webp') return 'webp'
  if (mimeType === 'video/mp4') return 'mp4'
  return 'png'
}

function imageMimeType(value: unknown, outputFormat: 'png' | 'jpeg' | 'webp') {
  const fallback = outputFormat === 'jpeg' ? 'image/jpeg' : `image/${outputFormat}`
  const mimeType = typeof value === 'string' ? value.toLowerCase() : fallback
  if (!['image/jpeg', 'image/png', 'image/webp'].includes(mimeType)) {
    throw new AiHttpError(502, 'AI_IMAGE_INVALID_RESPONSE', 'Image generation returned an unsupported media type.')
  }
  return mimeType
}

function videoMimeType(value: unknown) {
  const mimeType = typeof value === 'string' ? value.toLowerCase() : 'video/mp4'
  if (mimeType !== 'video/mp4') {
    throw new AiHttpError(502, 'AI_VIDEO_RESULT_INVALID', 'Video generation returned an unsupported media type.')
  }
  return mimeType
}

function normalizeSignedUrl(request: Request, rawUrl: string) {
  const incoming = new URL(request.url)
  let parsed: URL
  try {
    parsed = new URL(rawUrl, incoming.origin)
  } catch {
    throw new AiHttpError(502, 'AI_MEDIA_URL_FAILED', 'The media URL is invalid.')
  }
  let pathname = parsed.pathname
  if (pathname.startsWith('/object/')) pathname = `/storage/v1${pathname}`
  return `${incoming.origin}${pathname}${parsed.search}`
}

async function signedMedia(
  request: Request,
  config: NubaseServerConfig,
  user: AuthenticatedUser,
  row: AiJobRow,
) {
  if (!row.storage_path || !row.storage_mime_type) return null
  const allowedMimeTypes = row.kind === 'image'
    ? ['image/jpeg', 'image/png', 'image/webp']
    : ['video/mp4']
  if (!allowedMimeTypes.includes(row.storage_mime_type)) {
    throw new AiHttpError(502, 'AI_MEDIA_METADATA_INVALID', 'Stored media metadata is invalid.')
  }
  const expectedPath = `${user.id}/${row.id}/result.${extensionForMimeType(row.storage_mime_type)}`
  if (row.storage_bucket !== MEDIA_BUCKET || row.storage_path !== expectedPath) {
    throw new AiHttpError(502, 'AI_MEDIA_PATH_INVALID', 'Stored media does not belong to this AI job.')
  }
  const path = encodeStoragePath(row.storage_path)
  const response = await fetch(
    upstreamUrl(config, `/storage/v1/object/sign/${MEDIA_BUCKET}/${path}`),
    {
      method: 'POST',
      headers: projectHeaders(config, user.accessToken, true),
      body: JSON.stringify({ expiresIn: SIGNED_URL_TTL_SECONDS }),
    },
  )
  if (!response.ok) {
    await discardBody(response)
    throw new AiHttpError(502, 'AI_MEDIA_URL_FAILED', 'A private media URL could not be created.', response.status >= 500)
  }
  const payload = await readBoundedJson(response, MAX_SMALL_JSON_BYTES, 'AI_MEDIA_URL_INVALID_RESPONSE')
  const signedUrl = isRecord(payload)
    ? [payload.signedURL, payload.signedUrl, payload.signed_url].find((value) => typeof value === 'string')
    : undefined
  if (typeof signedUrl !== 'string') {
    throw new AiHttpError(502, 'AI_MEDIA_URL_INVALID_RESPONSE', 'A private media URL could not be created.')
  }
  return {
    url: normalizeSignedUrl(request, signedUrl),
    mimeType: row.storage_mime_type,
    expiresAt: new Date(Date.now() + SIGNED_URL_TTL_SECONDS * 1_000).toISOString(),
  }
}

async function publicJob(
  request: Request,
  config: NubaseServerConfig,
  user: AuthenticatedUser,
  row: AiJobRow,
  retryAfterMs?: number,
): Promise<NubaseAiMediaJob> {
  const media = row.status === 'succeeded'
    ? await signedMedia(request, config, user, row)
    : null
  return {
    id: row.id,
    kind: row.kind,
    status: row.status,
    model: row.model,
    media,
    error: row.status === 'failed'
      ? {
          code: row.error_code || 'AI_GENERATION_FAILED',
          message: row.error_message || 'AI generation failed.',
          retryable: false,
        }
      : null,
    ...(retryAfterMs !== undefined ? { retryAfterMs } : {}),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    completedAt: row.completed_at ?? null,
  }
}

function base64Bytes(value: string) {
  const paddingBytes = value.endsWith('==') ? 2 : value.endsWith('=') ? 1 : 0
  const decodedLength = Math.floor(value.length * 3 / 4) - paddingBytes
  if (!value || decodedLength <= 0) {
    throw new AiHttpError(502, 'AI_MEDIA_INVALID', 'The generated media is invalid.')
  }
  if (decodedLength > MAX_BASE64_MEDIA_BYTES) {
    throw new AiHttpError(502, 'AI_MEDIA_TOO_LARGE', 'The generated media exceeds the inline result limit.')
  }
  const buffer = new ArrayBuffer(decodedLength)
  const bytes = new Uint8Array(buffer)
  let written = 0
  try {
    for (let offset = 0; offset < value.length; offset += BASE64_DECODE_CHUNK_CHARS) {
      const decoded = atob(value.slice(offset, offset + BASE64_DECODE_CHUNK_CHARS))
      for (let index = 0; index < decoded.length; index += 1) {
        bytes[written] = decoded.charCodeAt(index)
        written += 1
      }
    }
  } catch {
    throw new AiHttpError(502, 'AI_MEDIA_INVALID', 'The generated media is invalid.')
  }
  if (written !== decodedLength) {
    throw new AiHttpError(502, 'AI_MEDIA_INVALID', 'The generated media is invalid.')
  }
  return buffer
}

async function uploadMediaBody(
  config: NubaseServerConfig,
  user: AuthenticatedUser,
  storagePath: string,
  body: BodyInit,
  mimeType: string,
) {
  const headers = projectHeaders(config, user.accessToken)
  headers.set('content-type', mimeType)
  headers.set('x-upsert', 'false')
  let response: Response
  try {
    response = await fetch(
      upstreamUrl(config, `/storage/v1/object/${MEDIA_BUCKET}/${encodeStoragePath(storagePath)}`),
      { method: 'POST', headers, body },
    )
  } catch {
    throw new AiHttpError(502, 'AI_MEDIA_STORE_FAILED', 'Generated media could not be stored.', true)
  }
  if (!response.ok && response.status !== 409) {
    await discardBody(response)
    throw new AiHttpError(
      502,
      'AI_MEDIA_STORE_FAILED',
      'Generated media could not be stored.',
      response.status === 429 || response.status >= 500,
    )
  }
  await discardBody(response)
}

async function persistMediaBytes(
  config: NubaseServerConfig,
  user: AuthenticatedUser,
  jobId: string,
  bytes: ArrayBuffer,
  mimeType: string,
) {
  const storagePath = `${user.id}/${jobId}/result.${extensionForMimeType(mimeType)}`
  await uploadMediaBody(config, user, storagePath, bytes, mimeType)
  return { storagePath, mimeType, sizeBytes: bytes.byteLength }
}

async function persistMediaUrl(
  config: NubaseServerConfig,
  user: AuthenticatedUser,
  jobId: string,
  sourceUrl: string,
  fallbackMimeType: string,
) {
  let url: URL
  try {
    url = new URL(sourceUrl)
  } catch {
    throw new AiHttpError(502, 'AI_VIDEO_RESULT_INVALID', 'The generated media URL is invalid.')
  }
  if (url.protocol !== 'https:') {
    throw new AiHttpError(502, 'AI_VIDEO_RESULT_INVALID', 'Only HTTPS video result URLs are supported.')
  }

  let source: Response
  try {
    source = await fetch(url, { redirect: 'follow' })
  } catch {
    throw new AiHttpError(502, 'AI_MEDIA_FETCH_FAILED', 'Generated media could not be downloaded.', true)
  }
  if (!source.ok || !source.body) {
    await discardBody(source)
    throw new AiHttpError(
      502,
      'AI_MEDIA_FETCH_FAILED',
      'Generated media could not be downloaded.',
      source.status === 429 || source.status >= 500,
    )
  }
  const contentLength = Number(source.headers.get('content-length'))
  if (Number.isFinite(contentLength) && contentLength > MAX_STREAMED_VIDEO_BYTES) {
    throw new AiHttpError(502, 'AI_MEDIA_TOO_LARGE', 'The generated video exceeds the storage limit.')
  }
  const mimeType = videoMimeType(
    source.headers.get('content-type')?.split(';')[0]?.trim() || fallbackMimeType,
  )
  const storagePath = `${user.id}/${jobId}/result.${extensionForMimeType(mimeType)}`
  let sizeBytes = 0
  const limiter = new TransformStream<Uint8Array, Uint8Array>({
    transform(chunk, controller) {
      sizeBytes += chunk.byteLength
      if (sizeBytes > MAX_STREAMED_VIDEO_BYTES) {
        throw new AiHttpError(502, 'AI_MEDIA_TOO_LARGE', 'The generated video exceeds the storage limit.')
      }
      controller.enqueue(chunk)
    },
  })
  await uploadMediaBody(config, user, storagePath, source.body.pipeThrough(limiter), mimeType)
  return { storagePath, mimeType, sizeBytes }
}

async function markFailed(
  config: NubaseServerConfig,
  user: AuthenticatedUser,
  row: AiJobRow,
  error: AiHttpError,
) {
  return updateJob(config, user, row.id, {
    status: 'failed',
    error_code: error.code,
    error_message: error.message,
    completed_at: new Date().toISOString(),
  })
}

function videoPollRetryAfter(row: AiJobRow) {
  return row.status === 'pending' || row.status === 'processing'
    ? VIDEO_RETRY_AFTER_MS
    : undefined
}

async function publicVideoPollState(
  request: Request,
  config: NubaseServerConfig,
  user: AuthenticatedUser,
  row: AiJobRow,
) {
  return publicJob(request, config, user, row, videoPollRetryAfter(row))
}

async function settleClaimedVideoPollError(
  request: Request,
  config: NubaseServerConfig,
  user: AuthenticatedUser,
  claimed: AiJobRow,
  error: unknown,
  fallback: { code: string; message: string },
) {
  const normalized = error instanceof AiHttpError
    ? error
    : new AiHttpError(502, fallback.code, fallback.message, true)
  const patch = normalized.retryable
    ? { status: 'pending' }
    : {
        status: 'failed',
        error_code: normalized.code,
        error_message: normalized.message,
        completed_at: new Date().toISOString(),
      }
  const row = await updateClaimedVideoJobOrLatest(config, user, claimed, patch)
  return publicVideoPollState(request, config, user, row)
}

async function handleChat(request: Request, config: NubaseServerConfig) {
  await authenticatedUser(request, config)
  const payload = await readBoundedJson(request, MAX_REQUEST_BYTES, 'AI_INVALID_REQUEST')
  if (!isRecord(payload) || !Array.isArray(payload.messages) || payload.messages.length === 0 || payload.messages.length > 50) {
    throw new AiHttpError(400, 'AI_INVALID_REQUEST', 'messages must contain between 1 and 50 items.')
  }
  let totalContentLength = 0
  const messages = payload.messages.map((raw) => {
    if (!isRecord(raw) || !['system', 'user', 'assistant'].includes(String(raw.role))) {
      throw new AiHttpError(400, 'AI_INVALID_REQUEST', 'Each message must have a valid role.')
    }
    const content = requiredString(raw.content, 'message content', 32_000)
    totalContentLength += content.length
    return { role: raw.role as 'system' | 'user' | 'assistant', content }
  })
  if (totalContentLength > 64_000) {
    throw new AiHttpError(400, 'AI_INVALID_REQUEST', 'Message content is too long.')
  }
  const maxTokens = optionalNumber(payload.maxTokens, 'maxTokens', 1_024, 1, 4_096)
  const temperature = optionalNumber(payload.temperature, 'temperature', 0.7, 0, 2)

  const response = await fetch(upstreamUrl(config, '/v1/chat/completions'), {
    method: 'POST',
    headers: gatewayHeaders(config),
    body: JSON.stringify({
      model: CHAT_MODEL,
      messages,
      max_tokens: maxTokens,
      temperature,
      stream: false,
    }),
  })
  if (!response.ok) {
    await discardBody(response)
    throw new AiHttpError(
      response.status === 429 ? 429 : 502,
      response.status === 429 ? 'AI_RATE_LIMITED' : 'AI_UPSTREAM_FAILED',
      response.status === 429 ? 'AI is busy. Try again shortly.' : 'Chat completion failed.',
      response.status === 429 || response.status >= 500,
    )
  }
  const upstream = await readBoundedJson(response, MAX_SMALL_JSON_BYTES, 'AI_UPSTREAM_INVALID_RESPONSE')
  const firstChoice = isRecord(upstream) && Array.isArray(upstream.choices) && isRecord(upstream.choices[0])
    ? upstream.choices[0]
    : null
  const message = firstChoice && isRecord(firstChoice.message) ? firstChoice.message : null
  if (!message || typeof message.content !== 'string') {
    throw new AiHttpError(502, 'AI_UPSTREAM_INVALID_RESPONSE', 'Chat completion returned no message.')
  }
  const usage = isRecord(upstream) && isRecord(upstream.usage) ? upstream.usage : null
  const result: NubaseAiChatCompletion = {
    id: isRecord(upstream) && typeof upstream.id === 'string' ? upstream.id : null,
    model: CHAT_MODEL,
    message: { role: 'assistant', content: message.content },
    finishReason: firstChoice && typeof firstChoice.finish_reason === 'string'
      ? firstChoice.finish_reason
      : null,
    usage: usage
      ? {
          ...(typeof usage.prompt_tokens === 'number' ? { promptTokens: usage.prompt_tokens } : {}),
          ...(typeof usage.completion_tokens === 'number' ? { completionTokens: usage.completion_tokens } : {}),
          ...(typeof usage.total_tokens === 'number' ? { totalTokens: usage.total_tokens } : {}),
        }
      : null,
  }
  return jsonResponse(result)
}

async function handleImageGeneration(request: Request, config: NubaseServerConfig) {
  const user = await authenticatedUser(request, config)
  const payload = await readBoundedJson(request, MAX_REQUEST_BYTES, 'AI_INVALID_REQUEST')
  if (!isRecord(payload)) throw new AiHttpError(400, 'AI_INVALID_REQUEST', 'Request body is invalid.')
  const prompt = requiredString(payload.prompt, 'prompt', 8_000)
  const imageSize = oneOf(payload.imageSize, 'imageSize', ['1024x1024', '1024x1536', '1536x1024'] as const, '1024x1024')
  const outputFormat = oneOf(payload.outputFormat, 'outputFormat', ['png', 'jpeg', 'webp'] as const, 'png')
  let row = await insertJob(config, user, {
    kind: 'image',
    status: 'processing',
    model: IMAGE_MODEL,
    request_json: { prompt, image_size: imageSize, output_format: outputFormat },
  })

  try {
    const response = await fetch(upstreamUrl(config, '/ai/v1/images/generations'), {
      method: 'POST',
      headers: gatewayHeaders(config),
      body: JSON.stringify({
        model: IMAGE_MODEL,
        task: 'text_to_image',
        prompt,
        config: {
          number_of_images: 1,
          image_size: imageSize,
          output_format: outputFormat,
        },
      }),
    })
    if (!response.ok) {
      await discardBody(response)
      throw new AiHttpError(
        response.status === 429 ? 429 : 502,
        response.status === 429 ? 'AI_RATE_LIMITED' : 'AI_IMAGE_UPSTREAM_FAILED',
        response.status === 429 ? 'AI is busy. Try again shortly.' : 'Image generation failed.',
        response.status === 429 || response.status >= 500,
      )
    }
    const upstream = await readBoundedJson(response, MAX_IMAGE_JSON_BYTES, 'AI_IMAGE_INVALID_RESPONSE')
    const output = isRecord(upstream) && Array.isArray(upstream.outputs)
      ? upstream.outputs.find((candidate): candidate is JsonRecord => (
          isRecord(candidate) && typeof candidate.b64_json === 'string'
        )) ?? null
      : null
    if (!output || typeof output.b64_json !== 'string') {
      throw new AiHttpError(502, 'AI_IMAGE_INVALID_RESPONSE', 'Image generation returned no image.')
    }
    const mimeType = imageMimeType(output.mime_type, outputFormat)
    const stored = await persistMediaBytes(config, user, row.id, base64Bytes(output.b64_json), mimeType)
    row = await updateJob(config, user, row.id, {
      status: 'succeeded',
      result_json: {},
      storage_bucket: MEDIA_BUCKET,
      storage_path: stored.storagePath,
      storage_mime_type: stored.mimeType,
      completed_at: new Date().toISOString(),
    })
  } catch (error) {
    const normalized = error instanceof AiHttpError
      ? error
      : new AiHttpError(502, 'AI_IMAGE_FAILED', 'Image generation failed.', true)
    row = await markFailed(config, user, row, normalized)
    throw normalized
  }
  return jsonResponse(await publicJob(request, config, user, row) as NubaseAiImageJob, 201)
}

async function handleImageJob(request: Request, config: NubaseServerConfig, jobId: string) {
  const user = await authenticatedUser(request, config)
  const row = await findJob(config, user, jobId)
  if (row.kind !== 'image') throw new AiHttpError(404, 'AI_JOB_NOT_FOUND', 'Image job was not found.')
  return jsonResponse(await publicJob(request, config, user, row) as NubaseAiImageJob)
}

async function handleVideoGeneration(request: Request, config: NubaseServerConfig) {
  const user = await authenticatedUser(request, config)
  const payload = await readBoundedJson(request, MAX_REQUEST_BYTES, 'AI_INVALID_REQUEST')
  if (!isRecord(payload)) throw new AiHttpError(400, 'AI_INVALID_REQUEST', 'Request body is invalid.')
  const prompt = requiredString(payload.prompt, 'prompt', 8_000)
  const durationSeconds = optionalNumber(payload.durationSeconds, 'durationSeconds', 6, 4, 15)
  const resolution = oneOf(payload.resolution, 'resolution', ['480p', '720p'] as const, '720p')
  const aspectRatio = oneOf(
    payload.aspectRatio,
    'aspectRatio',
    ['21:9', '16:9', '4:3', '1:1', '3:4', '9:16'] as const,
    '16:9',
  )
  const generateAudio = payload.generateAudio === undefined ? true : payload.generateAudio
  if (typeof generateAudio !== 'boolean') {
    throw new AiHttpError(400, 'AI_INVALID_REQUEST', 'generateAudio is invalid.')
  }

  let row = await insertJob(config, user, {
    kind: 'video',
    status: 'processing',
    model: VIDEO_MODEL,
    request_json: {
      prompt,
      duration_seconds: durationSeconds,
      resolution,
      aspect_ratio: aspectRatio,
      generate_audio: generateAudio,
    },
  })

  try {
    const response = await fetch(upstreamUrl(config, '/ai/v1/videos/generations'), {
      method: 'POST',
      headers: gatewayHeaders(config),
      body: JSON.stringify({
        model: VIDEO_MODEL,
        prompt,
        config: {
          duration_seconds: durationSeconds,
          resolution,
          aspect_ratio: aspectRatio,
          generate_audio: generateAudio,
        },
      }),
    })
    if (!response.ok) {
      await discardBody(response)
      throw new AiHttpError(
        response.status === 429 ? 429 : 502,
        response.status === 429 ? 'AI_RATE_LIMITED' : 'AI_VIDEO_SUBMIT_FAILED',
        response.status === 429 ? 'AI is busy. Try again shortly.' : 'Video generation could not be started.',
        response.status === 429 || response.status >= 500,
      )
    }
    const upstream = await readBoundedJson(response, MAX_SMALL_JSON_BYTES, 'AI_VIDEO_SUBMIT_INVALID_RESPONSE')
    if (!isRecord(upstream) || typeof upstream.name !== 'string' || typeof upstream.upstream !== 'string') {
      throw new AiHttpError(502, 'AI_VIDEO_SUBMIT_INVALID_RESPONSE', 'Video generation returned no operation.')
    }
    row = await updateJob(config, user, row.id, {
      status: 'pending',
      operation_name: upstream.name,
      upstream: upstream.upstream,
    })
    return jsonResponse(await publicJob(request, config, user, row) as NubaseAiVideoJob, 202)
  } catch (error) {
    const normalized = error instanceof AiHttpError
      ? error
      : new AiHttpError(502, 'AI_VIDEO_SUBMIT_FAILED', 'Video generation could not be started.', true)
    await markFailed(config, user, row, normalized)
    throw normalized
  }
}

function videoFromOperation(payload: unknown) {
  if (!isRecord(payload) || !isRecord(payload.response)) return null
  const videos = Array.isArray(payload.response.videos)
    ? payload.response.videos
    : Array.isArray(payload.response.generatedVideos)
      ? payload.response.generatedVideos
      : []
  return isRecord(videos[0]) ? videos[0] : null
}

async function pollVideoJob(
  request: Request,
  config: NubaseServerConfig,
  user: AuthenticatedUser,
  original: AiJobRow,
) {
  if (!original.operation_name || !original.upstream) {
    return settleClaimedVideoPollError(
      request,
      config,
      user,
      original,
      new AiHttpError(502, 'AI_VIDEO_OPERATION_INVALID', 'Video operation data is missing.'),
      { code: 'AI_VIDEO_OPERATION_INVALID', message: 'Video operation data is missing.' },
    )
  }

  let response: Response
  try {
    response = await fetch(upstreamUrl(config, '/ai/v1/videos/operations:fetch'), {
      method: 'POST',
      headers: gatewayHeaders(config),
      body: JSON.stringify({
        operation_name: original.operation_name,
        upstream: original.upstream,
      }),
    })
  } catch (error) {
    return settleClaimedVideoPollError(
      request,
      config,
      user,
      original,
      error,
      { code: 'AI_VIDEO_POLL_FAILED', message: 'Video generation status could not be read.' },
    )
  }
  if (response.status === 429 || response.status >= 500) {
    await discardBody(response)
    return settleClaimedVideoPollError(
      request,
      config,
      user,
      original,
      new AiHttpError(502, 'AI_VIDEO_POLL_FAILED', 'Video generation status could not be read.', true),
      { code: 'AI_VIDEO_POLL_FAILED', message: 'Video generation status could not be read.' },
    )
  }
  if (!response.ok) {
    await discardBody(response)
    return settleClaimedVideoPollError(
      request,
      config,
      user,
      original,
      new AiHttpError(502, 'AI_VIDEO_POLL_FAILED', 'Video generation status could not be read.'),
      { code: 'AI_VIDEO_POLL_FAILED', message: 'Video generation status could not be read.' },
    )
  }

  let payload: unknown
  try {
    payload = await readBoundedJson(response, MAX_VIDEO_JSON_BYTES, 'AI_VIDEO_POLL_INVALID_RESPONSE')
  } catch (error) {
    return settleClaimedVideoPollError(
      request,
      config,
      user,
      original,
      error,
      { code: 'AI_VIDEO_POLL_FAILED', message: 'Video generation status could not be read.' },
    )
  }
  if (!isRecord(payload) || payload.done !== true) {
    const pending = await updateClaimedVideoJobOrLatest(config, user, original, {
      status: 'pending',
    })
    return publicVideoPollState(request, config, user, pending)
  }
  if (payload.error) {
    return settleClaimedVideoPollError(
      request,
      config,
      user,
      original,
      new AiHttpError(502, 'AI_VIDEO_UPSTREAM_FAILED', 'Video generation failed upstream.'),
      { code: 'AI_VIDEO_UPSTREAM_FAILED', message: 'Video generation failed upstream.' },
    )
  }
  if (
    isRecord(payload.response)
    && typeof payload.response.raiMediaFilteredCount === 'number'
    && payload.response.raiMediaFilteredCount > 0
  ) {
    return settleClaimedVideoPollError(
      request,
      config,
      user,
      original,
      new AiHttpError(400, 'AI_VIDEO_CONTENT_FILTERED', 'The video was blocked by the content safety policy.'),
      { code: 'AI_VIDEO_CONTENT_FILTERED', message: 'The video was blocked by the content safety policy.' },
    )
  }

  const video = videoFromOperation(payload)
  if (!video) {
    return settleClaimedVideoPollError(
      request,
      config,
      user,
      original,
      new AiHttpError(502, 'AI_VIDEO_RESULT_MISSING', 'Video generation returned no video.'),
      { code: 'AI_VIDEO_RESULT_MISSING', message: 'Video generation returned no video.' },
    )
  }
  let stored: { storagePath: string; mimeType: string; sizeBytes: number }
  try {
    const mimeType = videoMimeType(video.mimeType)
    if (typeof video.bytesBase64Encoded === 'string') {
      stored = await persistMediaBytes(
        config,
        user,
        original.id,
        base64Bytes(video.bytesBase64Encoded),
        mimeType,
      )
    } else if (typeof video.gcsUri === 'string' && video.gcsUri) {
      stored = await persistMediaUrl(config, user, original.id, video.gcsUri, mimeType)
    } else {
      throw new AiHttpError(502, 'AI_VIDEO_RESULT_MISSING', 'Video generation returned no downloadable video.')
    }
  } catch (error) {
    return settleClaimedVideoPollError(
      request,
      config,
      user,
      original,
      error,
      { code: 'AI_MEDIA_FETCH_FAILED', message: 'Generated media could not be downloaded.' },
    )
  }
  const succeeded = await updateClaimedVideoJobOrLatest(config, user, original, {
    status: 'succeeded',
    result_json: { size_bytes: stored.sizeBytes },
    storage_bucket: MEDIA_BUCKET,
    storage_path: stored.storagePath,
    storage_mime_type: stored.mimeType,
    completed_at: new Date().toISOString(),
  })
  return publicVideoPollState(request, config, user, succeeded)
}

async function handleVideoJob(request: Request, config: NubaseServerConfig, jobId: string) {
  const user = await authenticatedUser(request, config)
  const row = await findJob(config, user, jobId)
  if (row.kind !== 'video') throw new AiHttpError(404, 'AI_JOB_NOT_FOUND', 'Video job was not found.')
  if (row.status === 'succeeded' || row.status === 'failed') {
    return jsonResponse(await publicJob(request, config, user, row) as NubaseAiVideoJob)
  }
  const lastPolledAt = row.last_polled_at ? Date.parse(row.last_polled_at) : Number.NaN
  if (Number.isFinite(lastPolledAt) && Date.now() - lastPolledAt < VIDEO_RETRY_AFTER_MS) {
    return jsonResponse(await publicJob(
      request,
      config,
      user,
      row,
      Math.max(1, VIDEO_RETRY_AFTER_MS - (Date.now() - lastPolledAt)),
    ) as NubaseAiVideoJob)
  }
  const claimed = await claimVideoPoll(config, user, row.id)
  if (!claimed) {
    const latest = await findJob(config, user, row.id)
    return jsonResponse(await publicJob(request, config, user, latest, VIDEO_RETRY_AFTER_MS) as NubaseAiVideoJob)
  }
  return jsonResponse(await pollVideoJob(request, config, user, claimed) as NubaseAiVideoJob)
}

async function handleVideoList(request: Request, config: NubaseServerConfig) {
  const user = await authenticatedUser(request, config)
  const rows = await listVideoJobs(config, user)
  const jobs = await Promise.all(
    rows.map((row) => publicJob(request, config, user, row) as Promise<NubaseAiVideoJob>),
  )
  return jsonResponse({ jobs })
}

function routeJobId(pathname: string, prefix: string) {
  if (!pathname.startsWith(prefix)) return null
  const suffix = pathname.slice(prefix.length)
  if (!suffix || suffix.includes('/')) return null
  try {
    return decodeURIComponent(suffix)
  } catch {
    return null
  }
}

function allowedMethodForPath(pathname: string): 'GET' | 'POST' | null {
  if (
    pathname === `${AI_ROUTE_PREFIX}/chat/completions`
    || pathname === `${AI_ROUTE_PREFIX}/images/generations`
    || pathname === `${AI_ROUTE_PREFIX}/videos/generations`
  ) {
    return 'POST'
  }
  if (
    pathname === `${AI_ROUTE_PREFIX}/videos/jobs`
    || routeJobId(pathname, `${AI_ROUTE_PREFIX}/images/jobs/`)
    || routeJobId(pathname, `${AI_ROUTE_PREFIX}/videos/jobs/`)
  ) {
    return 'GET'
  }
  return null
}

export async function handleNubaseAiRequest(
  request: Request,
  config: NubaseServerConfig | undefined,
): Promise<Response | undefined> {
  const pathname = new URL(request.url).pathname
  if (pathname !== AI_ROUTE_PREFIX && !pathname.startsWith(`${AI_ROUTE_PREFIX}/`)) {
    return undefined
  }
  const allowedMethod = allowedMethodForPath(pathname)
  if (!allowedMethod) {
    return errorResponse(new AiHttpError(404, 'AI_ROUTE_NOT_FOUND', 'AI route was not found.'))
  }
  if (request.method !== allowedMethod) return methodNotAllowedResponse(allowedMethod)
  if (!config) {
    return errorResponse(new AiHttpError(503, 'AI_NOT_CONFIGURED', 'AI is not configured for this app.'))
  }

  try {
    if (pathname === `${AI_ROUTE_PREFIX}/chat/completions`) {
      return await handleChat(request, config)
    }
    if (pathname === `${AI_ROUTE_PREFIX}/images/generations`) {
      return await handleImageGeneration(request, config)
    }
    const imageJobId = routeJobId(pathname, `${AI_ROUTE_PREFIX}/images/jobs/`)
    if (imageJobId) {
      return await handleImageJob(request, config, imageJobId)
    }
    if (pathname === `${AI_ROUTE_PREFIX}/videos/generations`) {
      return await handleVideoGeneration(request, config)
    }
    if (pathname === `${AI_ROUTE_PREFIX}/videos/jobs`) {
      return await handleVideoList(request, config)
    }
    const videoJobId = routeJobId(pathname, `${AI_ROUTE_PREFIX}/videos/jobs/`)
    if (videoJobId) {
      return await handleVideoJob(request, config, videoJobId)
    }
    return errorResponse(new AiHttpError(404, 'AI_ROUTE_NOT_FOUND', 'AI route was not found.'))
  } catch (error) {
    const normalized = error instanceof AiHttpError
      ? error
      : new AiHttpError(500, 'AI_INTERNAL_ERROR', 'The AI request failed unexpectedly.')
    console.error(JSON.stringify({
      message: 'nubase_ai_request_failed',
      path: pathname,
      status: normalized.status,
      code: normalized.code,
    }))
    return errorResponse(normalized)
  }
}
