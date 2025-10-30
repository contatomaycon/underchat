import type { App } from 'vue';
import { vMaska } from 'maska/vue';

function installMaska(app: App): void {
  app.directive('maska', vMaska);
}

export default installMaska;
