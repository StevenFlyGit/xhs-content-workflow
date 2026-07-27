# Ottermind VibeCoding Project Contract

This project is generated from the fixed `ottermind-vibecoding-website` template. For normal feature work, do not rescan the template structure; edit the requested business files and use the build tool as the verification gate.

## Runtime

- Use Bun: `bun install`, `bun run <script>`.
- TanStack Start routes live under `src/routes`.
- The main editable entrypoints are listed in `.ottermind/template-manifest.json`.
- `src/server.ts`, `src/start.ts`, `src/platform`, and `src/integrations/nubase` are platform-managed runtime files. Backend provisioning installs and upgrades them as one versioned unit; application code must not edit them.
- Use `src/routes/index.tsx` as the default first product screen and composition entrypoint.
- For larger UI, add focused feature components under `src/components` and compose them from route files; do not pack a complex app into one long route file.
- Keep business layout, product copy, sample data, and interaction state out of `src/routes/__root.tsx`; root owns document shell only.
- Do not manually edit `src/routeTree.gen.ts`; route generation owns it.
- Keep `vite.config.ts` as a thin call to `defineVibeCodingConfig()` from `@ottermind/vibecoding-tanstack-config`; do not expand build config for normal app work.
- Use `createServerFn` from `@tanstack/react-start` for server-only application logic.
- Do not use Next.js or Remix patterns such as `getServerSideProps`, `"use server"`, `app/layout.tsx`, or Server Actions.

## UI

- Tailwind CSS v4 and shadcn-style primitives are preinstalled.
- Use components from `src/components/ui` before adding custom primitive markup.
- Use `cn()` from `src/lib/utils` for conditional class composition.
- Use `lucide-react` icons for controls when an icon exists.
- Build the first usable version. Apps, tools, dashboards, games, and prototypes need a working core workflow, not a static homepage shell.
- Tabs, buttons, forms, filters, menus, and primary actions must be wired to React state, Radix/shadcn primitives, TanStack Router navigation, validation, submit feedback, toasts, or another visible behavior.
- Local React state and realistic sample data are expected for frontend-only prototypes. They are not backend over-engineering.

## Backend

- Nubase is optional. Frontend-only apps must not import `src/integrations/nubase`.
- Simple landing pages, static content pages, and local-only prototypes should not provision auth, database, storage, persistence, or server functions unless the user explicitly asks for real backend behavior.
- When the user asks for registration, login, private user data, database tables, storage, CRUD, or server-backed data, call `mcp__ottermind__ensure_vibecoding_backend` before writing Nubase-dependent code.
- Prefer module ids: `auth.email_password`, `auth.google_oauth`, `database.crud`, `storage.private_bucket`, `server_functions.secure_action`, and `ai.nubase_gateway`.
- Application code must import Nubase helpers from `src/integrations/nubase` after provisioning. Do not create custom Nubase clients such as `src/nubase`, `src/lib/nubase.ts`, or feature-local Nubase client files.
- Do not import `@supabase/supabase-js` directly in routes, components, loaders, or server functions.
- Do not read `window.__NUBASE_PUBLIC_CONFIG__` directly and do not handwrite `/auth/v1`, `/rest/v1`, `/storage/v1`, or `/auth/v1/admin/*` fetches.
- For email/password registration, use `nubase.auth.signUpWithEmailVerification(...)`. Treat `session` as the only logged-in signal. If the result has `status: 'verification_required'` or no session, show a check-your-email state and do not enter protected app UI from `data.user` alone.
- Login/register errors must render `error.message` or `nubase.auth.describeError(error)`. Never display raw `JSON.stringify(error)`, because Nubase auth errors can stringify to `{}`.
- For Google login, use `nubase.auth.signInWithOAuth({ provider: "google" })`; if the backend tool reports missing Google OAuth config, tell the user to configure it in Studio before claiming login works.
- For schema/RLS changes, use `mcp__ottermind__apply_nubase_migration`. Applied SQL must live under `backend/nubase/migrations` and be tracked by `backend/nubase/manifest.json`.
- For AI chat, image generation, or video generation, provision `ai.nubase_gateway` and use only `nubase.ai`. All AI calls require a real Nubase session. Do not handwrite `/.ottermind/ai`, Nubase gateway paths, model ids, or gateway-key access.
- Use `nubase.ai.chat.complete(...)` for chat and `nubase.ai.images.generate(...)` for private generated images. Image results are jobs with refreshable signed media URLs; call `nubase.ai.images.get(jobId)` to refresh an expired URL.
- Video generation is asynchronous. Call `nubase.ai.videos.create(...)` exactly once, persist the returned job id in UI state, and use `nubase.ai.videos.wait(jobId, { signal })` or `get(jobId)` to poll. On reload, call `nubase.ai.videos.list()` and resume pending jobs with `wait(...)`. Never implement a second submit inside a polling or retry loop.
- Inline Base64 media is limited to 8 MiB. Larger completed videos require a downloadable HTTPS `gcsUri`; do not try to fetch or expose `gs://` results from application code.

```ts
import { nubase } from './integrations/nubase'

const signup = await nubase.auth.signUpWithEmailVerification({ email, password })
if (signup.status === 'verification_required') showCheckEmailState(signup.email)
await nubase.auth.signInWithPassword({ email, password })
await nubase.auth.resendSignUpConfirmation(email)
await nubase.auth.signInWithOAuth({ provider: 'google' })
await completeOAuthRedirect()
await nubase.from('profiles').select()
const reply = await nubase.ai.chat.complete({
  messages: [{ role: 'user', content: 'Hello' }],
})
const image = await nubase.ai.images.generate({ prompt: 'A quiet mountain lake' })
const video = await nubase.ai.videos.create({ prompt: 'Clouds crossing a valley' })
const completedVideo = await nubase.ai.videos.wait(video.id)
```

## Secrets And Workers

- Do not put secrets, service-role keys, database clients, or server-only side effects in route loaders or client-reachable module scope.
- In Cloudflare Workers, runtime env is per-request. Avoid reading `process.env.*` at module scope.
- Server-only Nubase helpers such as `createNubaseAdminClient()` may only be imported from `.server.ts` modules or server-only code paths.
