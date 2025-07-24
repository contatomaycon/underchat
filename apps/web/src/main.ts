import { createApp } from 'vue';
import App from '@/App.vue';
import { registerPlugins } from '@/@webcore/utils/plugins';
import '@webcore/scss/template/index.scss';
import '@styles/styles.scss';

const app = createApp(App);

registerPlugins(app);

app.mount('#app');
