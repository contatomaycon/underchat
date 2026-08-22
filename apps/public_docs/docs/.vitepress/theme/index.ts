import ScalarApiReferenceStyles from '@scalar/api-reference/style.css?inline';
import DefaultTheme from 'vitepress/theme';
import type { Theme } from 'vitepress';
import ApiBaseUrl from './components/ApiBaseUrl.vue';
import HomeHero from './components/HomeHero.vue';
import ScalarReference from './components/ScalarReference.vue';
import './styles.css';

export default {
  extends: DefaultTheme,
  enhanceApp({ app }) {
    app.component('ApiBaseUrl', ApiBaseUrl);
    app.component('HomeHero', HomeHero);
    app.component('ScalarReference', ScalarReference);

    if (typeof document !== 'undefined') {
      const style = document.createElement('style');
      style.dataset.scalarStyles = 'underchat';
      style.textContent = ScalarApiReferenceStyles;
      document.head.append(style);
    }
  },
} satisfies Theme;
