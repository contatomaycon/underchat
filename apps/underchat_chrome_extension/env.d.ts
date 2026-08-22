interface ImportMetaEnv {
  readonly MAIN_VITE_UNDERCHAT_MANAGER_API_URL?: string;
  readonly VITE_UNDERCHAT_EXTENSION_API_BASE_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

declare const __UNDERCHAT_EXTENSION_API_BASE_URL__: string;
declare const __UNDERCHAT_EXTENSION_VERSION__: string;
