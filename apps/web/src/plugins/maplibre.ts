import VueMapLibre from 'vue-maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import 'vue-maplibre-gl/dist/vue-maplibre-gl.css';
import type { App } from 'vue';

function installMapLibre(app: App): void {
  app.use(VueMapLibre);
}

export default installMapLibre;
