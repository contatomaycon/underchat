import en from '@/plugins/i18n/locales/en.json';
import 'vue-i18n';

type LocaleMessage = typeof en;

declare module 'vue-i18n' {
  export interface DefineLocaleMessage extends LocaleMessage {}
}
