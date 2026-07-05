declare module '*.css?inline' {
  const content: string;
  export default content;
}

interface ImportMetaEnv {
  readonly DEV: boolean;
  readonly MAIN_VITE_UNDERCHAT_MANAGER_API_URL?: string;
  readonly MODE: string;
  readonly PROD: boolean;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
