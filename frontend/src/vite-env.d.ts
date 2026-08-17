/// <reference types="vite/client" />

// Injected by Vite `define` from frontend/package.json — see vite.config.ts.
declare const __APP_VERSION__: string;

interface ImportMetaEnv {
  readonly VITE_API_BASE_URL?: string;
  /** Public feedback form/issue tracker URL. When unset the feedback row is hidden. */
  readonly VITE_FEEDBACK_URL?: string;
  /**
   * Link that accompanies a shared translation (t.me/share/url requires one).
   * Defaults to https://t.me/SlangUA_bot.
   */
  readonly VITE_SHARE_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
