import { App } from 'vue';
import { vMaska } from 'maska/vue';

export default (app: App) => {
  app.directive('maska', vMaska);
};
