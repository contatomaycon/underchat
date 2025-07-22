import { createApp } from 'vue';
import App from '@/App.vue';
import { registerPlugins } from '@core/utils/plugins';
import '@core/scss/template/index.scss';
import '@styles/styles.scss';

const app = createApp(App);

registerPlugins(app);

app.mount('#app');
