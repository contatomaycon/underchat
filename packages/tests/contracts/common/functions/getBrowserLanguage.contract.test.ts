import { getBrowserLanguage } from '@core/common/functions/getBrowserLanguage';

describe('getBrowserLanguage', () => {
  const originalNavigator = globalThis.navigator;

  afterEach(() => {
    Object.defineProperty(globalThis, 'navigator', {
      value: originalNavigator,
      configurable: true,
    });
  });

  it('returns es for spanish browser language', () => {
    Object.defineProperty(globalThis, 'navigator', {
      value: { language: 'es-AR', languages: ['es-AR'] },
      configurable: true,
    });

    expect(getBrowserLanguage()).toBe('es');
  });

  it('returns en for english browser language', () => {
    Object.defineProperty(globalThis, 'navigator', {
      value: { language: 'en-US', languages: ['en-US'] },
      configurable: true,
    });

    expect(getBrowserLanguage()).toBe('en');
  });

  it('falls back to pt for unsupported or missing language', () => {
    Object.defineProperty(globalThis, 'navigator', {
      value: { language: 'fr-FR', languages: ['fr-FR'] },
      configurable: true,
    });
    expect(getBrowserLanguage()).toBe('pt');

    Object.defineProperty(globalThis, 'navigator', {
      value: { language: '', languages: ['pt-BR'] },
      configurable: true,
    });
    expect(getBrowserLanguage()).toBe('pt');

    Object.defineProperty(globalThis, 'navigator', {
      value: { language: '', languages: [] },
      configurable: true,
    });
    expect(getBrowserLanguage()).toBe('pt');
  });
});
