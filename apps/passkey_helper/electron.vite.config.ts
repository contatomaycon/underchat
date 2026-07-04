import { resolve } from 'node:path';

import { defineConfig } from 'electron-vite';

export default defineConfig({
  main: {
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
    build: {
      outDir: 'dist/renderer',
      rollupOptions: {
        input: {
          overlay: resolve(__dirname, 'src/renderer/overlay.ts'),
        },
      },
    },
  },
});
