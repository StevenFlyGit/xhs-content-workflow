export type NubaseAiJobStatus = 'pending' | 'processing' | 'succeeded' | 'failed'

export interface NubaseAiMedia {
  url: string
  mimeType: string
  expiresAt: string
}

export interface NubaseAiJobError {
  code: string
  message: string
  retryable: boolean
}

export interface NubaseAiMediaJob {
  id: string
  kind: 'image' | 'video'
  status: NubaseAiJobStatus
  model: string
  media: NubaseAiMedia | null
  error: NubaseAiJobError | null
  retryAfterMs?: number
  createdAt: string
  updatedAt: string
  completedAt: string | null
}

export type NubaseAiImageJob = NubaseAiMediaJob & { kind: 'image' }
export type NubaseAiVideoJob = NubaseAiMediaJob & { kind: 'video' }

export interface NubaseAiChatMessage {
  role: 'system' | 'user' | 'assistant'
  content: string
}

export interface NubaseAiChatInput {
  messages: NubaseAiChatMessage[]
  maxTokens?: number
  temperature?: number
  signal?: AbortSignal
}

export interface NubaseAiChatCompletion {
  id: string | null
  model: string
  message: NubaseAiChatMessage
  finishReason: string | null
  usage: {
    promptTokens?: number
    completionTokens?: number
    totalTokens?: number
  } | null
}

export interface NubaseAiImageInput {
  prompt: string
  imageSize?: '1024x1024' | '1024x1536' | '1536x1024'
  outputFormat?: 'png' | 'jpeg' | 'webp'
  signal?: AbortSignal
}

export interface NubaseAiVideoInput {
  prompt: string
  durationSeconds?: number
  resolution?: '480p' | '720p'
  aspectRatio?: '21:9' | '16:9' | '4:3' | '1:1' | '3:4' | '9:16'
  generateAudio?: boolean
  signal?: AbortSignal
}

export interface NubaseAiVideoWaitOptions {
  signal?: AbortSignal
  intervalMs?: number
  timeoutMs?: number
}

type NubaseAiFetch = (path: string, options?: RequestInit) => Promise<Response>

interface ErrorEnvelope {
  error?: {
    code?: unknown
    message?: unknown
    retryable?: unknown
  }
}

export class NubaseAiRequestError extends Error {
  readonly code: string
  readonly status: number
  readonly retryable: boolean

  constructor(input: { code: string; message: string; status: number; retryable?: boolean }) {
    super(input.message)
    this.name = 'NubaseAiRequestError'
    this.code = input.code
    this.status = input.status
    this.retryable = input.retryable === true
  }
}

async function readJson(response: Response): Promise<unknown> {
  try {
    return await response.json()
  } catch {
    throw new NubaseAiRequestError({
      code: 'AI_INVALID_RESPONSE',
      message: 'The AI service returned an invalid response.',
      status: 502,
      retryable: true,
    })
  }
}

async function unwrap<T>(response: Response): Promise<T> {
  const payload = await readJson(response)
  if (response.ok) return payload as T

  const envelope = payload && typeof payload === 'object'
    ? payload as ErrorEnvelope
    : undefined
  const upstream = envelope?.error
  throw new NubaseAiRequestError({
    code: typeof upstream?.code === 'string' ? upstream.code : 'AI_REQUEST_FAILED',
    message: typeof upstream?.message === 'string'
      ? upstream.message
      : 'The AI request failed.',
    status: response.status,
    retryable: upstream?.retryable === true,
  })
}

function jsonBody(value: unknown): Pick<RequestInit, 'body' | 'headers'> {
  return {
    body: JSON.stringify(value),
    headers: { 'content-type': 'application/json' },
  }
}

function abortError(): DOMException {
  return new DOMException('The operation was aborted.', 'AbortError')
}

function waitFor(ms: number, signal?: AbortSignal): Promise<void> {
  if (signal?.aborted) return Promise.reject(abortError())
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort)
      resolve()
    }, ms)
    const onAbort = () => {
      clearTimeout(timer)
      reject(abortError())
    }
    signal?.addEventListener('abort', onAbort, { once: true })
  })
}

export function createNubaseAiClient(fetcher: NubaseAiFetch) {
  async function getImage(jobId: string, signal?: AbortSignal) {
    const response = await fetcher(
      `/.ottermind/ai/images/jobs/${encodeURIComponent(jobId)}`,
      { method: 'GET', signal },
    )
    return unwrap<NubaseAiImageJob>(response)
  }

  async function getVideo(jobId: string, signal?: AbortSignal) {
    const response = await fetcher(
      `/.ottermind/ai/videos/jobs/${encodeURIComponent(jobId)}`,
      { method: 'GET', signal },
    )
    return unwrap<NubaseAiVideoJob>(response)
  }

  return {
    chat: {
      async complete(input: NubaseAiChatInput): Promise<NubaseAiChatCompletion> {
        const response = await fetcher('/.ottermind/ai/chat/completions', {
          method: 'POST',
          signal: input.signal,
          ...jsonBody({
            messages: input.messages,
            ...(input.maxTokens !== undefined ? { maxTokens: input.maxTokens } : {}),
            ...(input.temperature !== undefined ? { temperature: input.temperature } : {}),
          }),
        })
        return unwrap<NubaseAiChatCompletion>(response)
      },
    },
    images: {
      async generate(input: NubaseAiImageInput): Promise<NubaseAiImageJob> {
        const response = await fetcher('/.ottermind/ai/images/generations', {
          method: 'POST',
          signal: input.signal,
          ...jsonBody({
            prompt: input.prompt,
            ...(input.imageSize ? { imageSize: input.imageSize } : {}),
            ...(input.outputFormat ? { outputFormat: input.outputFormat } : {}),
          }),
        })
        return unwrap<NubaseAiImageJob>(response)
      },
      get: getImage,
    },
    videos: {
      async create(input: NubaseAiVideoInput): Promise<NubaseAiVideoJob> {
        const response = await fetcher('/.ottermind/ai/videos/generations', {
          method: 'POST',
          signal: input.signal,
          ...jsonBody({
            prompt: input.prompt,
            ...(input.durationSeconds !== undefined
              ? { durationSeconds: input.durationSeconds }
              : {}),
            ...(input.resolution ? { resolution: input.resolution } : {}),
            ...(input.aspectRatio ? { aspectRatio: input.aspectRatio } : {}),
            ...(input.generateAudio !== undefined
              ? { generateAudio: input.generateAudio }
              : {}),
          }),
        })
        return unwrap<NubaseAiVideoJob>(response)
      },
      get: getVideo,
      async list(options?: { signal?: AbortSignal }): Promise<NubaseAiVideoJob[]> {
        const response = await fetcher('/.ottermind/ai/videos/jobs', {
          method: 'GET',
          signal: options?.signal,
        })
        const payload = await unwrap<{ jobs: NubaseAiVideoJob[] }>(response)
        return payload.jobs
      },
      async wait(
        jobId: string,
        options: NubaseAiVideoWaitOptions = {},
      ): Promise<NubaseAiVideoJob> {
        const intervalMs = Math.max(1, options.intervalMs ?? 10_000)
        const timeoutMs = Math.max(1, options.timeoutMs ?? 10 * 60_000)
        const deadline = Date.now() + timeoutMs

        while (true) {
          if (options.signal?.aborted) throw abortError()
          const job = await getVideo(jobId, options.signal)
          if (job.status === 'succeeded' || job.status === 'failed') return job
          if (Date.now() >= deadline) {
            throw new NubaseAiRequestError({
              code: 'AI_VIDEO_WAIT_TIMEOUT',
              message: 'Video generation is still in progress.',
              status: 408,
              retryable: true,
            })
          }
          const delay = Math.max(intervalMs, job.retryAfterMs ?? 0)
          await waitFor(Math.min(delay, Math.max(1, deadline - Date.now())), options.signal)
        }
      },
    },
  }
}

export type NubaseAiClient = ReturnType<typeof createNubaseAiClient>
