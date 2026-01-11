import { injectable } from 'tsyringe';
import { ISummaryProvider } from './ISummaryProvider';

@injectable()
export class OpenAISummaryProvider implements ISummaryProvider {
  async generateSummary(
    prompt: string,
    baseUrl: string,
    apiKey: string,
    model: string
  ): Promise<string> {
    const url = `${baseUrl}/chat/completions`;
    const tokenParam = this.getTokenParamForModel(model);
    const requestBody = this.buildRequestBody(prompt, model, tokenParam, 2048);

    let response = await this.fetchWithRetry(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify(requestBody),
    });

    if (!response.ok) {
      const errorText = await response.text();
      const fallbackTokenParam = this.getFallbackTokenParam(errorText);

      if (fallbackTokenParam && fallbackTokenParam !== tokenParam) {
        const retryBody = this.buildRequestBody(
          prompt,
          model,
          fallbackTokenParam,
          2048
        );
        response = await this.fetchWithRetry(url, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${apiKey}`,
          },
          body: JSON.stringify(retryBody),
        });

        if (!response.ok) {
          const retryErrorText = await response.text();
          throw new Error(
            `OpenAI API error: ${response.status} - ${retryErrorText}`
          );
        }
      } else {
        throw new Error(`OpenAI API error: ${response.status} - ${errorText}`);
      }
    }

    const data = (await response.json()) as {
      choices?: Array<{
        message?: {
          content?: string;
        };
      }>;
    };

    return data.choices?.[0]?.message?.content || 'Erro ao gerar sumário.';
  }

  private buildRequestBody(
    prompt: string,
    model: string,
    tokenParam: 'max_tokens' | 'max_completion_tokens',
    maxTokens: number
  ): {
    model: string;
    messages: Array<{ role: 'system' | 'user'; content: string }>;
    temperature: number;
    max_tokens?: number;
    max_completion_tokens?: number;
  } {
    const requestBody: {
      model: string;
      messages: Array<{ role: 'system' | 'user'; content: string }>;
      temperature: number;
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
      temperature: 0.3,
    };

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

  private getFallbackTokenParam(
    errorText: string
  ): 'max_tokens' | 'max_completion_tokens' | null {
    try {
      const parsed = JSON.parse(errorText) as {
        error?: { param?: string; code?: string; message?: string };
      };
      const param = parsed.error?.param;
      const code = parsed.error?.code;

      if (code !== 'unsupported_parameter' || !param) {
        return null;
      }

      if (param === 'max_tokens') {
        return 'max_completion_tokens';
      }

      if (param === 'max_completion_tokens') {
        return 'max_tokens';
      }
    } catch {}

    if (errorText.includes('max_tokens')) {
      return 'max_completion_tokens';
    }

    if (errorText.includes('max_completion_tokens')) {
      return 'max_tokens';
    }

    return null;
  }

  private async fetchWithRetry(
    url: string,
    options: RequestInit,
    maxRetries = 3,
    timeoutMs = 30000
  ): Promise<Response> {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

    const fetchOptions: RequestInit = {
      ...options,
      signal: controller.signal,
    };

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        const response = await fetch(url, fetchOptions);
        clearTimeout(timeoutId);
        return response;
      } catch (error) {
        clearTimeout(timeoutId);

        if (attempt === maxRetries) {
          throw error;
        }

        const delayMs = Math.min(1000 * Math.pow(2, attempt - 1), 5000);
        await new Promise((resolve) => setTimeout(resolve, delayMs));
      }
    }

    throw new Error('Max retries exceeded');
  }
}
