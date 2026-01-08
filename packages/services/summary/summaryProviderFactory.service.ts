import { injectable } from 'tsyringe';
import { ISummaryProvider } from './ISummaryProvider';
import { OpenAISummaryProvider } from './openAiSummaryProvider.service';
import { GeminiSummaryProvider } from './geminiSummaryProvider.service';

@injectable()
export class SummaryProviderFactory {
  constructor(
    private readonly openAiProvider: OpenAISummaryProvider,
    private readonly geminiProvider: GeminiSummaryProvider
  ) {}

  getProvider(aiAgentTypeId: string, baseUrl: string): ISummaryProvider {
    const isGemini = this.isGeminiApi(aiAgentTypeId, baseUrl);

    if (isGemini) {
      return this.geminiProvider;
    }

    return this.openAiProvider;
  }

  private isGeminiApi(aiAgentTypeId: string, baseUrl: string): boolean {
    const normalizedTypeId = aiAgentTypeId.toLowerCase();
    const normalizedBaseUrl = baseUrl.toLowerCase();

    return (
      normalizedTypeId.includes('gemini') ||
      normalizedBaseUrl.includes('googleapis.com') ||
      normalizedBaseUrl.includes('generativelanguage.googleapis.com')
    );
  }
}
