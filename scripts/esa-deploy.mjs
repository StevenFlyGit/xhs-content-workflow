#!/usr/bin/env node
/**
 * Deploys a packaged ESA Edge Routine (JS_AND_ASSETS zip) to Alibaba Cloud ESA.
 *
 * Flow (per alibabacloud-esa-pages-deploy skill):
 *   1. GetErService / OpenErService  — ensure Edge Routine service is online
 *   2. CreateRoutine                 — create or reuse the routine
 *   3. CreateRoutineWithAssetsCodeVersion — obtain OSS upload signature
 *   4. Upload zip to OSS
 *   5. Poll GetRoutineCodeVersionInfo until the build is available
 *   6. CreateRoutineCodeDeployment   — staging + production (percentage 100)
 *   7. GetRoutine + GetRoutineAccessToken — print the access URL
 *
 * Usage:
 *   node scripts/esa-deploy.mjs [routineName] [zipPath]
 *
 * Credentials: Alibaba Cloud default credential chain
 * (ALIBABA_CLOUD_ACCESS_KEY_ID / ALIBABA_CLOUD_ACCESS_KEY_SECRET).
 */
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import Esa20240910, * as $Esa20240910 from '@alicloud/esa20240910'
import * as $OpenApi from '@alicloud/openapi-client'
import * as $Util from '@alicloud/tea-util'
import Credential from '@alicloud/credentials'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const ROUTINE_NAME = process.argv[2] || 'xhs-content-workflow'
const ZIP_PATH = process.argv[3] || path.join(ROOT, 'esa', `${ROUTINE_NAME}.zip`)
const USER_AGENT = 'AlibabaCloud-Agent-Skills/alibabacloud-esa-pages-deploy'

function createClient() {
  const credential = new Credential.default()
  const config = new $OpenApi.Config({
    credential,
    endpoint: 'esa.cn-hangzhou.aliyuncs.com',
    userAgent: USER_AGENT,
  })
  return new Esa20240910.default(config)
}

function callApiParams(action, method) {
  return new $OpenApi.Params({
    action,
    version: '2024-09-10',
    protocol: 'https',
    method,
    authType: 'AK',
    bodyType: 'json',
    reqBodyType: 'json',
    style: 'RPC',
    pathname: '/',
  })
}

async function ensureErService(client, runtime) {
  const status = await client.getErService(new $Esa20240910.GetErServiceRequest({}))
  if (status.body?.status === 'online') return
  await client.openErService(new $Esa20240910.OpenErServiceRequest({}))
  const recheck = await client.getErService(new $Esa20240910.GetErServiceRequest({}))
  if (recheck.body?.status !== 'online') {
    throw new Error('Failed to enable Edge Routine service. Check account permissions (AliyunESAFullAccess).')
  }
}

async function ensureRoutine(client, name) {
  try {
    await client.createRoutine(new $Esa20240910.CreateRoutineRequest({
      name,
      description: 'xhs-content-workflow TanStack Start SSR app',
    }))
    console.log(`[esa-deploy] Routine created: ${name}`)
  } catch (error) {
    if (!String(error?.message ?? '').includes('RoutineNameAlreadyExist')) throw error
    console.log(`[esa-deploy] Routine exists, deploying new version: ${name}`)
  }
}

async function uploadZip(client, runtime, name, zipBuffer) {
  const result = await client.callApi(
    callApiParams('CreateRoutineWithAssetsCodeVersion', 'POST'),
    new $OpenApi.OpenApiRequest({ body: { Name: name } }),
    runtime,
  )
  const oss = result.body?.OssPostConfig || {}
  const codeVersion = result.body?.CodeVersion
  if (!codeVersion || !oss.Url) {
    throw new Error(`CreateRoutineWithAssetsCodeVersion failed: ${JSON.stringify(result.body)}`)
  }

  const formData = new FormData()
  formData.append('OSSAccessKeyId', oss.OSSAccessKeyId)
  formData.append('Signature', oss.Signature)
  formData.append('policy', oss.Policy)
  formData.append('key', oss.Key)
  if (oss.XOssSecurityToken) formData.append('x-oss-security-token', oss.XOssSecurityToken)
  formData.append('file', new Blob([zipBuffer], { type: 'application/zip' }))

  const upload = await fetch(oss.Url, { method: 'POST', body: formData })
  if (!upload.ok) {
    throw new Error(`OSS upload failed: HTTP ${upload.status} ${await upload.text()}`)
  }
  console.log(`[esa-deploy] Uploaded zip (${(zipBuffer.byteLength / 1024 / 1024).toFixed(2)} MB), code version: ${codeVersion}`)
  return codeVersion
}

async function waitForBuild(client, runtime, name, codeVersion) {
  for (let attempt = 0; attempt < 300; attempt += 1) {
    const info = await client.callApi(
      callApiParams('GetRoutineCodeVersionInfo', 'GET'),
      new $OpenApi.OpenApiRequest({ query: { Name: name, CodeVersion: codeVersion } }),
      runtime,
    )
    const status = String(info.body?.Status || '').toLowerCase()
    if (status === 'available') return
    if (status && status !== 'init') {
      throw new Error(`Routine build failed with status: ${status}`)
    }
    await new Promise((resolve) => setTimeout(resolve, 1000))
  }
  throw new Error('Timed out waiting for the routine build to become available.')
}

async function deployVersion(client, runtime, name, codeVersion, env) {
  await client.callApi(
    callApiParams('CreateRoutineCodeDeployment', 'POST'),
    new $OpenApi.OpenApiRequest({
      query: {
        Name: name,
        Env: env,
        Strategy: 'percentage',
        CodeVersions: JSON.stringify([{ Percentage: 100, CodeVersion: codeVersion }]),
      },
    }),
    runtime,
  )
  console.log(`[esa-deploy] Deployed to ${env}: ${codeVersion}`)
}

async function printAccessUrl(client, name) {
  const routine = await client.getRoutine(new $Esa20240910.GetRoutineRequest({ name }))
  const domain = routine.body.defaultRelatedRecord
  if (!domain) return
  try {
    const tokenResp = await client.getRoutineAccessToken(
      new $Esa20240910.GetRoutineAccessTokenRequest({ name }),
    )
    const token = tokenResp.body?.accessToken
    console.log(`[esa-deploy] Access URL: https://${domain}${token ? `?esa_er_token=${token}` : ''}`)
  } catch {
    console.log(`[esa-deploy] Access URL: https://${domain}`)
  }
}

async function main() {
  if (!existsSync(ZIP_PATH)) {
    console.error(`[esa-deploy] Zip not found: ${ZIP_PATH}`)
    console.error('[esa-deploy] Run `bun run build && bun run package:esa` first.')
    process.exit(1)
  }
  const zipBuffer = readFileSync(ZIP_PATH)
  const client = createClient()
  const runtime = new $Util.RuntimeOptions({})

  await ensureErService(client, runtime)
  await ensureRoutine(client, ROUTINE_NAME)
  const codeVersion = await uploadZip(client, runtime, ROUTINE_NAME, zipBuffer)
  await waitForBuild(client, runtime, ROUTINE_NAME, codeVersion)
  for (const env of ['staging', 'production']) {
    await deployVersion(client, runtime, ROUTINE_NAME, codeVersion, env)
  }
  await printAccessUrl(client, ROUTINE_NAME)
}

main().catch((error) => {
  console.error('[esa-deploy] Failed:', error?.message ?? error)
  process.exit(1)
})
