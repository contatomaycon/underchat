import { ELanguage } from '../enums/ELanguage';
import { getLanguageId } from './getLanguageId';

export function createLanguageData(language: ELanguage): {
  code: ELanguage;
  id: number;
} {
  return {
    code: language,
    id: getLanguageId(language),
  };
}
