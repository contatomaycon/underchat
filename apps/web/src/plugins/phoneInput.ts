import 'flag-icons/css/flag-icons.min.css';
import 'v-phone-input/styles';
import { createVPhoneInput, VPhoneCountryFlagSvg } from 'v-phone-input';
import type { App } from 'vue';

function installVPhoneInput(app: App): void {
  const vPhoneInput = createVPhoneInput({
    countryDisplayComponent: VPhoneCountryFlagSvg,
    defaultCountry: 'BR',
    preferCountries: ['BR'],
  });

  app.use(vPhoneInput);
}

export default installVPhoneInput;
