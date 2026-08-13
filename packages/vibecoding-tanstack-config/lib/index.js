import tailwindcss from '@tailwindcss/vite'
import { devtools } from '@tanstack/devtools-vite'
import { tanstackStart } from '@tanstack/react-start/plugin/vite'
import viteReact from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

export function defineVibeCodingConfig(options = {}) {
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
        // the server entry. Node builtins stay external and require the
        // routine's Node.js compatibility mode.
        resolve: { noExternal: true },
      },
    },
    plugins: [
      devtools(),
      tailwindcss(),
      tanstackStart({ server: { entry: options.serverEntry ?? 'server' } }),
      viteReact(),
      ...(extra.plugins ?? []),
    ],
  })
}
