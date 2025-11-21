import { ComponentOptions, DefineComponent } from 'vue';

declare module '*.vue' {
  const component: DefineComponent<{}, {}, any>;
  export default component;
}

declare module 'vue-prism-component' {
  const component: ComponentOptions;
  export default component;
}
declare module 'vue-shepherd';
declare module '@videojs-player/vue';
