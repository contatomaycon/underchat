declare module '*.vue' {
  const component: import('vue').DefineComponent<{}, {}, any>;
  export default component;
}

declare module 'vue-prism-component' {
  const component: import('vue').ComponentOptions;
  export default component;
}
declare module 'vue-shepherd';
declare module '@videojs-player/vue';
