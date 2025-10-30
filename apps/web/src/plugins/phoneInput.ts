import 'flag-icons/css/flag-icons.min.css';
import 'v-phone-input/dist/v-phone-input.css';
import { createVPhoneInput } from 'v-phone-input';
import type { App } from 'vue';

function installVPhoneInput(app: App): void {
  const vPhoneInput = createVPhoneInput({
    countryIconMode: 'svg',
    defaultCountry: 'BR',
    preferCountries: ['BR'],
  });

  app.use(vPhoneInput);
}

export default installVPhoneInput;
