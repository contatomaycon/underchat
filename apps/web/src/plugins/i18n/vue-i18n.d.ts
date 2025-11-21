import pt from '@/plugins/i18n/locales/pt.json';
import 'vue-i18n';

type LocaleMessage = typeof pt;

declare module 'vue-i18n' {
  export interface DefineLocaleMessage extends LocaleMessage {}
}
