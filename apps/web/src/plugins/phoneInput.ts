import 'flag-icons/css/flag-icons.min.css';
import 'v-phone-input/dist/v-phone-input.css';
import { createVPhoneInput } from 'v-phone-input';
import { App } from 'vue';

export default (app: App) => {
  const vPhoneInput = createVPhoneInput({
    countryIconMode: 'svg',
  });

  app.use(vPhoneInput);
};
