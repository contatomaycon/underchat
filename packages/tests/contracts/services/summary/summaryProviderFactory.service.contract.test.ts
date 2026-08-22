import 'reflect-metadata';
import { EAiAgentType } from '@core/common/enums/EAiAgentType';
import { SummaryProviderFactory } from '@core/services/summary/summaryProviderFactory.service';

describe('SummaryProviderFactory', () => {
  it('returns gemini provider only for the Gemini agent type UUID', () => {
    const openAiProvider = { id: 'openai' };
    const geminiProvider = { id: 'gemini' };
    const factory = new SummaryProviderFactory(
      openAiProvider as never,
      geminiProvider as never
    );

    expect(
      factory.getProvider(EAiAgentType.gemini, 'https://example.com')
    ).toBe(geminiProvider);
  });

  it('preserves OpenAI-compatible routing for other and custom providers', () => {
    const openAiProvider = { id: 'openai' };
    const geminiProvider = { id: 'gemini' };
    const factory = new SummaryProviderFactory(
      openAiProvider as never,
      geminiProvider as never
    );

    expect(factory.getProvider('gemini', 'https://example.com')).toBe(
      openAiProvider
    );
    expect(
      factory.getProvider(
        EAiAgentType.others,
        'https://generativelanguage.googleapis.com/v1beta/openai'
      )
    ).toBe(openAiProvider);
    expect(
      factory.getProvider(EAiAgentType.gpt, 'https://api.openai.com/v1')
    ).toBe(openAiProvider);
    expect(
      factory.getProvider(EAiAgentType.deepseek, 'https://api.deepseek.com/v1')
    ).toBe(openAiProvider);
  });
});
