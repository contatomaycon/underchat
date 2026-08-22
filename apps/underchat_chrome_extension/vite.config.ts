import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { defineConfig, loadEnv, type Plugin } from 'vite';

const packageJson = JSON.parse(
  readFileSync(new URL('./package.json', import.meta.url), 'utf8')
) as { version?: string };

function normalizeApiBaseUrl(value: string | undefined): string {
  const normalized = value?.trim().replace(/\/+$/, '') ?? '';

  return normalized || 'http://localhost:3002';
}

function toMatchPattern(apiBaseUrl: string): string {
  try {
    const origin = new URL(apiBaseUrl).origin;
    return `${origin}/*`;
  } catch {
    return 'http://localhost/*';
  }
}

function manifestPlugin(apiBaseUrl: string): Plugin {
  return {
    name: 'underchat-chrome-extension-manifest',
    generateBundle() {
      this.emitFile({
        fileName: 'manifest.json',
        source: JSON.stringify(
          {
            action: {
              default_icon: {
                16: 'icons/icon.png',
                32: 'icons/icon.png',
                48: 'icons/icon.png',
                128: 'icons/icon.png',
              },
              default_popup: 'popup.html',
              default_title: 'Underchat',
            },
            background: {
              service_worker: 'service-worker.js',
              type: 'module',
            },
            description:
              'Conecta uma sessão autenticada do WhatsApp Web à Underchat.',
            host_permissions: [
              'https://web.whatsapp.com/*',
              toMatchPattern(apiBaseUrl),
            ],
            icons: {
              16: 'icons/icon.png',
              32: 'icons/icon.png',
              48: 'icons/icon.png',
              128: 'icons/icon.png',
            },
            manifest_version: 3,
            name: 'Underchat',
            permissions: [
              'activeTab',
              'alarms',
              'browsingData',
              'scripting',
              'storage',
              'tabs',
            ],
            version: packageJson.version ?? '1.0.0',
          },
          null,
          2
        ),
        type: 'asset',
      });
    },
  };
}

export default defineConfig(({ mode }) => {
  const channel = mode === 'production' ? 'prod' : 'dev';
  const env = loadEnv(mode, process.cwd(), ['MAIN_VITE_', 'VITE_']);
  const apiBaseUrl = normalizeApiBaseUrl(
    env.MAIN_VITE_UNDERCHAT_MANAGER_API_URL ??
      env.VITE_UNDERCHAT_EXTENSION_API_BASE_URL ??
      process.env.MAIN_VITE_UNDERCHAT_MANAGER_API_URL ??
      process.env.VITE_UNDERCHAT_EXTENSION_API_BASE_URL
  );

  return {
    build: {
      emptyOutDir: true,
      outDir: `dist/${channel}`,
      rollupOptions: {
        input: {
          holding: resolve(__dirname, 'holding.html'),
          popup: resolve(__dirname, 'popup.html'),
          'service-worker': resolve(__dirname, 'src/service-worker.ts'),
        },
        output: {
          assetFileNames: 'assets/[name][extname]',
          chunkFileNames: 'assets/[name].js',
          entryFileNames: '[name].js',
        },
      },
      sourcemap: mode !== 'production',
    },
    define: {
      __UNDERCHAT_EXTENSION_API_BASE_URL__: JSON.stringify(apiBaseUrl),
      __UNDERCHAT_EXTENSION_VERSION__: JSON.stringify(
        packageJson.version ?? '1.0.0'
      ),
    },
    plugins: [manifestPlugin(apiBaseUrl)],
  };
});
