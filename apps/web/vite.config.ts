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
import { defineConfig, loadEnv } from 'vite';
import VueDevTools from 'vite-plugin-vue-devtools';
import MetaLayouts from 'vite-plugin-vue-meta-layouts';
import vuetify from 'vite-plugin-vuetify';
import svgLoader from 'vite-svg-loader';

export default defineConfig(({ mode }) => {
  const root = fileURLToPath(new URL('../../', import.meta.url));
  const env = loadEnv(mode, root, '');

  return {
    envDir: root,
    define: {
      'process.env': env,
    },
    plugins: [
      VueRouter({
        getRouteName: (routeNode) =>
          getPascalCaseRouteName(routeNode)
            .replace(/([a-z\d])([A-Z])/g, '$1-$2')
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
      VueDevTools(),
      vueJsx(),
      vuetify({
        styles: { configFile: 'src/assets/styles/variables/_vuetify.scss' },
      }),
      MetaLayouts({ target: './src/layouts', defaultLayout: 'default' }),
      Components({
        dirs: ['src/@core/components', 'src/views/demos', 'src/components'],
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
          './src/@core/utils',
          './src/@core/composable/',
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
        '@core': fileURLToPath(new URL('./src/@core', import.meta.url)),
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
        '@main/': fileURLToPath(
          new URL('../../packages/core/', import.meta.url)
        ),
      },
    },
    build: { chunkSizeWarningLimit: 5000 },
    optimizeDeps: { exclude: ['vuetify'], entries: ['./src/**/*.vue'] },
  };
});
