import { injectable, inject } from 'tsyringe';
import { ISummaryProvider } from './ISummaryProvider';
import { OpenAISummaryProvider } from './openAiSummaryProvider.service';
import { GeminiSummaryProvider } from './geminiSummaryProvider.service';
import { EAiAgentType } from '@core/common/enums/EAiAgentType';

@injectable()
export class SummaryProviderFactory {
  constructor(
    @inject(OpenAISummaryProvider)
    private readonly openAiProvider: OpenAISummaryProvider,
    @inject(GeminiSummaryProvider)
    private readonly geminiProvider: GeminiSummaryProvider
  ) {}

  getProvider(aiAgentTypeId: string, _baseUrl: string): ISummaryProvider {
    void _baseUrl;

    if (aiAgentTypeId === EAiAgentType.gemini) {
      return this.geminiProvider;
    }

    return this.openAiProvider;
  }
}
