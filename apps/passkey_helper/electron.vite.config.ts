import { resolve } from 'node:path';

import { defineConfig } from 'electron-vite';

export default defineConfig(({ mode }) => {
  const channel =
    process.env.UNDERCHAT_PASSKEY_HELPER_CHANNEL ??
    (mode === 'development' ? 'dev' : 'prod');
  const define = {
    __UNDERCHAT_PASSKEY_HELPER_CHANNEL__: JSON.stringify(channel),
  };

  return {
    main: {
      define,
      build: {
        externalizeDeps: true,
        outDir: 'dist/main',
        rollupOptions: {
          external: ['electron'],
          input: {
            index: resolve(__dirname, 'src/main/index.ts'),
          },
        },
      },
    },
    preload: {
      define,
      build: {
        externalizeDeps: true,
        outDir: 'dist/preload',
        rollupOptions: {
          external: ['electron'],
          input: {
            index: resolve(__dirname, 'src/preload/index.ts'),
          },
        },
      },
    },
    renderer: {
      define,
      build: {
        outDir: 'dist/renderer',
        rollupOptions: {
          input: {
            overlay: resolve(__dirname, 'src/renderer/overlay.ts'),
          },
        },
      },
    },
  };
});
