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
  return defineConfig(({ command }) => ({
    ...extra,
    resolve: {
      tsconfigPaths: true,
      ...(extra.resolve ?? {}),
    },
    // ESA Edge Routine has no npm runtime, so production builds must bundle
    // every dependency into the server entry. Node builtins stay external and
    // are shimmed at packaging time. Dev keeps the default external behavior
    // — inlining CJS deps (e.g. react) breaks Vite's dev module runner.
    ...(command === 'build'
      ? { environments: { ssr: { resolve: { noExternal: true } } } }
      : {}),
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
  }))
}
