/// <reference types="vite/client" />

declare module '*.vue' {
  const component: import('vue').DefineComponent;
  export default component;
}

declare module '@scalar/api-reference/style.css?inline' {
  const styles: string;
  export default styles;
}

interface ImportMetaEnv {
  readonly VITE_API_PUBLIC_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
