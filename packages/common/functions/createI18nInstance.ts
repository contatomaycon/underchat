import i18next, { TFunction } from 'i18next';
import Backend from 'i18next-fs-backend';
import path from 'path';

export async function createI18nInstance(
  language: string
): Promise<TFunction<'translation', undefined>> {
  const localesPath = path.join(
    __dirname,
    '../../plugins/i18next/locales/{{lng}}/translation.json'
  );

  const instance = i18next.createInstance();

  await instance.use(Backend).init({
    lng: language,
    fallbackLng: 'pt',
    backend: {
      loadPath: localesPath,
    },
    interpolation: {
      escapeValue: false,
    },
    returnNull: false,
    returnEmptyString: false,
    returnObjects: false,
    initImmediate: false,
  });

  await instance.loadLanguages(language);

  return instance.t;
}
