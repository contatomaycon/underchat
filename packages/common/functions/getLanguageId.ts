import { ELanguage } from '../enums/ELanguage';

const languageMap: Record<ELanguage, number> = {
  pt: 1,
  en: 2,
  es: 3,
};

export function getLanguageId(language: ELanguage): number {
  return languageMap[language] ?? 1;
}
