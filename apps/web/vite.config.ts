import vue from '@vitejs/plugin-vue';
import vueJsx from '@vitejs/plugin-vue-jsx';
import { fileURLToPath } from 'node:url';
import AutoImport from 'unplugin-auto-import/vite';
import Components from 'unplugin-vue-components/vite';
import {
  VueRouterAutoImports,
  getPascalCaseRouteName,
} from 'unplugin-vue-router';
import VueRouter from 'unplugin-vue-router/vite';
import { defineConfig } from 'vite';
import VueDevTools from 'vite-plugin-vue-devtools';
import MetaLayouts from 'vite-plugin-vue-meta-layouts';
import vuetify from 'vite-plugin-vuetify';
import svgLoader from 'vite-svg-loader';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig(({ mode }) => {
  const isProduction = mode === 'production';
  const chunkGroups = [
    {
      name: 'vendor-editor',
      matches: ['/node_modules/@tiptap/', '/node_modules/prosemirror-'],
    },
    {
      name: 'vendor-charts',
      matches: [
        '/node_modules/apexcharts/',
        '/node_modules/chart.js/',
        '/node_modules/vue3-apexcharts/',
        '/node_modules/vue-chartjs/',
      ],
    },
    {
      name: 'vendor-maps',
      matches: [
        '/node_modules/mapbox-gl/',
        '/node_modules/maplibre-gl/',
        '/node_modules/vue-maplibre-gl/',
      ],
    },
    {
      name: 'vendor-chat-extras',
      matches: [
        '/node_modules/emoji-mart-vue-fast/',
        '/node_modules/@emoji-mart/',
        '/node_modules/lottie-web/',
        '/node_modules/video.js/',
        '/node_modules/@videojs-player/',
      ],
    },
    {
      name: 'vendor-icons',
      matches: ['/node_modules/@iconify/'],
    },
  ];

  const manualChunks = (id: string): string | undefined => {
    const normalizedId = id.replaceAll('\\', '/');

    if (!normalizedId.includes('/node_modules/')) {
      return undefined;
    }

    const chunkGroup = chunkGroups.find((group) =>
      group.matches.some((matcher) => normalizedId.includes(matcher))
    );

    return chunkGroup?.name ?? 'vendor';
  };

  return {
    server: {
      fs: {
        allow: [
          path.resolve(__dirname),
          path.resolve(__dirname, '../node_modules'),
          path.resolve(__dirname, '../../node_modules'),
        ],
      },
    },
    plugins: [
      VueRouter({
        getRouteName: (routeNode) =>
          getPascalCaseRouteName(routeNode)
            .replaceAll(/([a-z\d])([A-Z])/g, '$1-$2')
            .toLowerCase(),
      }),
      vue({
        template: {
          compilerOptions: {
            isCustomElement: (tag) =>
              tag === 'swiper-container' || tag === 'swiper-slide',
          },
        },
      }),
      ...(isProduction ? [] : [VueDevTools()]),
      vueJsx(),
      vuetify({
        styles: { configFile: 'src/assets/styles/variables/_vuetify.scss' },
      }),
      MetaLayouts({ target: './src/layouts', defaultLayout: 'default' }),
      Components({
        dirs: ['src/@webcore/components', 'src/views/demos', 'src/components'],
        dts: true,
        resolvers: [
          (name) =>
            name === 'VueApexCharts'
              ? {
                  name: 'default',
                  from: 'vue3-apexcharts',
                  as: 'VueApexCharts',
                }
              : null,
        ],
      }),
      AutoImport({
        imports: [
          'vue',
          VueRouterAutoImports,
          '@vueuse/core',
          '@vueuse/math',
          'vue-i18n',
          'pinia',
        ],
        dirs: [
          './src/@webcore/utils',
          './src/@webcore/composable/',
          './src/composables/',
          './src/utils/',
          './src/plugins/*/composables/*',
        ],
        vueTemplate: true,
        ignore: ['useCookies', 'useStorage'],
      }),
      svgLoader(),
    ],
    resolve: {
      alias: {
        '@': fileURLToPath(new URL('./src', import.meta.url)),
        '@themeConfig': fileURLToPath(
          new URL('./themeConfig.ts', import.meta.url)
        ),
        '@webcore': fileURLToPath(new URL('./src/@webcore', import.meta.url)),
        '@layouts': fileURLToPath(new URL('./src/@layouts', import.meta.url)),
        '@images': fileURLToPath(
          new URL('./src/assets/images/', import.meta.url)
        ),
        '@styles': fileURLToPath(
          new URL('./src/assets/styles/', import.meta.url)
        ),
        '@configured-variables': fileURLToPath(
          new URL(
            './src/assets/styles/variables/_template.scss',
            import.meta.url
          )
        ),
        '@api-utils': fileURLToPath(
          new URL('./src/plugins/fake-api/utils/', import.meta.url)
        ),
        '@core/': fileURLToPath(new URL('../../packages/', import.meta.url)),
      },
    },
    build: {
      chunkSizeWarningLimit: 1500,
      rollupOptions: {
        output: {
          manualChunks,
        },
      },
    },
    optimizeDeps: { exclude: ['vuetify'], entries: ['./src/**/*.vue'] },
  };
});
