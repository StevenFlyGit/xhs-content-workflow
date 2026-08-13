import tailwindcss from '@tailwindcss/vite'
import { tanstackStart } from '@tanstack/react-start/plugin/vite'
import { devtools } from '@tanstack/devtools-vite'
import viteReact from '@vitejs/plugin-react'
import { defineConfig, type UserConfig } from 'vite'

export interface VibeCodingTanStackConfigOptions {
  serverEntry?: string
  extraConfig?: UserConfig
}

export function defineVibeCodingConfig(options: VibeCodingTanStackConfigOptions = {}) {
  const extra = options.extraConfig ?? {}
  return defineConfig({
    ...extra,
    resolve: {
      tsconfigPaths: true,
      ...(extra.resolve ?? {}),
    },
    environments: {
      ssr: {
        // ESA Edge Routine has no npm runtime: bundle every dependency into
        // the server entry. Node builtins (node:async_hooks, node:stream, ...)
        // stay external and require the routine's Node.js compatibility mode.
        resolve: { noExternal: true },
      },
    },
    plugins: [
      devtools(),
      tailwindcss(),
      tanstackStart({
        server: {
          entry: options.serverEntry ?? 'server',
        },
      }),
      viteReact(),
      ...(extra.plugins ?? []),
    ],
  })
}
