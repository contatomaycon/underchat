import 'reflect-metadata';
import { SummaryProviderFactory } from '@core/services/summary/summaryProviderFactory.service';

describe('SummaryProviderFactory', () => {
  it('returns gemini provider when type id or base url indicates gemini', () => {
    const openAiProvider = { id: 'openai' };
    const geminiProvider = { id: 'gemini' };
    const factory = new SummaryProviderFactory(
      openAiProvider as never,
      geminiProvider as never
    );

    expect(factory.getProvider('gemini', 'https://example.com')).toBe(
      geminiProvider
    );
    expect(
      factory.getProvider('other', 'https://generativelanguage.googleapis.com')
    ).toBe(geminiProvider);
  });

  it('returns openai provider by default', () => {
    const openAiProvider = { id: 'openai' };
    const geminiProvider = { id: 'gemini' };
    const factory = new SummaryProviderFactory(
      openAiProvider as never,
      geminiProvider as never
    );

    expect(factory.getProvider('openai', 'https://api.openai.com')).toBe(
      openAiProvider
    );
  });
});
