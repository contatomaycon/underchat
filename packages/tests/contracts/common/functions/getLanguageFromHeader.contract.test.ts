import { ELanguage } from '@core/common/enums/ELanguage';
import { getLanguageFromHeader } from '@core/common/functions/getLanguageFromHeader';

describe('getLanguageFromHeader', () => {
  it('defaults to pt when header is missing', () => {
    expect(getLanguageFromHeader(undefined)).toBe(ELanguage.pt);
  });

  it('extracts language from simple or weighted headers', () => {
    expect(getLanguageFromHeader('en-US,en;q=0.9')).toBe(ELanguage.en);
    expect(getLanguageFromHeader('es-AR,es;q=0.8')).toBe(ELanguage.es);
  });

  it('falls back to pt for unsupported languages', () => {
    expect(getLanguageFromHeader('fr-FR,fr;q=0.9')).toBe(ELanguage.pt);
  });
});
