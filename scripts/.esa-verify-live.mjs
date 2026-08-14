// One-off live verification against the deployed ESA routine (HTTP while the
// HTTPS certificate is still provisioning). Requires ALIBABA_CLOUD_ACCESS_KEY_ID/SECRET.
import EsaSdk, * as R from '@alicloud/esa20240910'
import * as O from '@alicloud/openapi-client'
import Cred from '@alicloud/credentials'

const client = new EsaSdk.default(new O.Config({
  credential: new Cred.default(),
  endpoint: 'esa.cn-hangzhou.aliyuncs.com',
}))
const t = await client.getRoutineAccessToken(new R.GetRoutineAccessTokenRequest({ name: 'xhs-content-workflow' }))
const token = t.body.token
const base = 'http://xhs-content-workflow.a47d0df4.er.aliyun-esa.net'
const authHeaders = { cookie: `esa_er_token=${token}` }

const cases = [
  { path: '/', method: 'GET' },
  { path: '/auth/v1/settings', method: 'GET' },
  { path: '/.ottermind/ai/chat/completions', method: 'POST', body: JSON.stringify({ messages: [{ role: 'user', content: 'hi' }] }) },
]

for (const c of cases) {
  const url = `${base}${c.path}`
  const r = await fetch(url, {
    method: c.method,
    redirect: 'follow',
    headers: { ...authHeaders, ...(c.body ? { 'content-type': 'application/json' } : {}) },
    body: c.body,
  }).catch((e) => ({ err: e.cause?.code || e.message }))
  if (r.err) {
    console.log(c.path, '=> ERR', r.err)
    continue
  }
  const ct = r.headers.get('content-type') || ''
  let note = ''
  if (ct.includes('html')) {
    const html = await r.text()
    const title = html.match(/<title>([\s\S]*?)<\/title>/)
    note = `html ${html.length}B <html>=${html.includes('<html')} title=${JSON.stringify(title?.[1] ?? '')}`
  } else if (ct.includes('json')) {
    note = (await r.text()).slice(0, 120)
  }
  console.log(c.path, '=>', r.status, ct.split(';')[0], note)
}
