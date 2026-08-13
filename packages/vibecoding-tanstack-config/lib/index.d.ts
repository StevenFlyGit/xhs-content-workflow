import type { UserConfig } from 'vite'

export interface VibeCodingTanStackConfigOptions {
  serverEntry?: string
  extraConfig?: UserConfig
}

export declare function defineVibeCodingConfig(
  options?: VibeCodingTanStackConfigOptions,
): UserConfig
