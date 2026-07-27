import '@tanstack/react-start/server-only'
import { handleNubaseAiRequest } from '../integrations/nubase/ai.server'
import {
  getNubasePublicConfigFromEnv,
  getNubaseServerConfigFromEnv,
} from '../integrations/nubase/config'

type RuntimeEnv = Record<string, unknown>

export async function handlePlatformAiRequest(
  request: Request,
  env?: RuntimeEnv,
): Promise<Response | undefined> {
  const requestOrigin = new URL(request.url).origin
  const publicConfig = getNubasePublicConfigFromEnv(env, requestOrigin)
  return handleNubaseAiRequest(request, getNubaseServerConfigFromEnv(env, publicConfig))
}
