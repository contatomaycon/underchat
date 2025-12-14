import { ELanguage } from '../enums/ELanguage';

export function getLanguageFromHeader(
  acceptLanguage: string | undefined
): ELanguage {
  if (!acceptLanguage) {
    return ELanguage.pt;
  }

  const languageCode = acceptLanguage.split(',')[0].split('-')[0].toLowerCase();

  if (languageCode === 'en') {
    return ELanguage.en;
  }

  if (languageCode === 'es') {
    return ELanguage.es;
  }

  return ELanguage.pt;
}
