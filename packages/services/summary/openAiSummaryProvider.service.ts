import { injectable } from 'tsyringe';
import { ISummaryProvider } from './ISummaryProvider';
import { executeSummaryOutboundHttp } from './summaryOutboundHttp.service';

@injectable()
export class OpenAISummaryProvider implements ISummaryProvider {
  async generateSummary(
    prompt: string,
    baseUrl: string,
    apiKey: string,
    model: string
  ): Promise<string> {
    const url = this.buildChatCompletionsUrl(baseUrl);
    const tokenParam = this.getTokenParamForModel(model);
    const requestBody = this.buildRequestBody(
      prompt,
      model,
      tokenParam,
      2048,
      tokenParam === 'max_completion_tokens' ? undefined : 0.3
    );

    const response = await executeSummaryOutboundHttp({
      providerName: 'OpenAI',
      url,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify(requestBody),
    });

    if (response.statusCode < 200 || response.statusCode > 299) {
      throw new Error(
        `OpenAI API request failed with status ${response.statusCode}.`
      );
    }

    let data: {
      readonly choices?: ReadonlyArray<{
        readonly message?: {
          readonly content?: unknown;
        };
      }>;
    };
    try {
      data = JSON.parse(response.body.toString('utf8')) as typeof data;
    } catch {
      throw new Error('OpenAI API returned an invalid response.');
    }

    const content = data.choices?.[0]?.message?.content;
    const summary = typeof content === 'string' ? content.trim() : '';

    if (!summary) {
      throw new Error('OpenAI API returned an empty summary.');
    }

    return summary;
  }

  private buildChatCompletionsUrl(baseUrl: string): string {
    const normalizedBaseUrl = baseUrl.trim().replace(/\/+$/, '');

    if (!normalizedBaseUrl) {
      throw new Error('OpenAI API base URL is invalid.');
    }

    if (/\/chat\/completions$/i.test(normalizedBaseUrl)) {
      return normalizedBaseUrl;
    }

    return `${normalizedBaseUrl}/chat/completions`;
  }

  private buildRequestBody(
    prompt: string,
    model: string,
    tokenParam: 'max_tokens' | 'max_completion_tokens',
    maxTokens: number,
    temperature?: number
  ): {
    model: string;
    messages: Array<{ role: 'system' | 'user'; content: string }>;
    temperature?: number;
    max_tokens?: number;
    max_completion_tokens?: number;
  } {
    const requestBody: {
      model: string;
      messages: Array<{ role: 'system' | 'user'; content: string }>;
      temperature?: number;
      max_tokens?: number;
      max_completion_tokens?: number;
    } = {
      model,
      messages: [
        {
          role: 'system',
          content:
            'Você é um assistente especializado em criar sumários concisos.',
        },
        {
          role: 'user',
          content: prompt,
        },
      ],
    };

    if (typeof temperature === 'number') {
      requestBody.temperature = temperature;
    }

    if (tokenParam === 'max_completion_tokens') {
      requestBody.max_completion_tokens = maxTokens;
    } else {
      requestBody.max_tokens = maxTokens;
    }

    return requestBody;
  }

  private getTokenParamForModel(
    model: string
  ): 'max_tokens' | 'max_completion_tokens' {
    const normalized = model?.toLowerCase() || '';
    if (normalized.includes('gpt-5')) {
      return 'max_completion_tokens';
    }
    return 'max_tokens';
  }
}
