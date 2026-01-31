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
    const requestBody = this.buildRequestBody(
      prompt,
      model,
      tokenParam,
      2048,
      0.3
    );

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
      const fallbackTemperature = this.getFallbackTemperature(errorText);

      let retryTokenParam = tokenParam;
      let retryTemperature: number | undefined = 0.3;
      let shouldRetry = false;

      if (fallbackTokenParam && fallbackTokenParam !== tokenParam) {
        retryTokenParam = fallbackTokenParam;
        shouldRetry = true;
      }

      if (fallbackTemperature !== null) {
        retryTemperature = fallbackTemperature;
        shouldRetry = true;
      }

      if (shouldRetry) {
        const retryBody = this.buildRequestBody(
          prompt,
          model,
          retryTokenParam,
          2048,
          retryTemperature
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

  private getFallbackTemperature(errorText: string): number | undefined | null {
    try {
      const parsed = JSON.parse(errorText) as {
        error?: { param?: string; code?: string; message?: string };
      };
      const param = parsed.error?.param;
      const code = parsed.error?.code;
      const message = parsed.error?.message || '';

      if (param !== 'temperature') {
        return null;
      }

      if (code === 'unsupported_value') {
        return 1;
      }

      if (code === 'unsupported_parameter') {
        return undefined;
      }

      if (message.includes('default (1)')) {
        return 1;
      }
    } catch {}

    if (
      errorText.includes('"temperature"') &&
      errorText.includes('default (1)')
    ) {
      return 1;
    }

    if (errorText.includes('"temperature"')) {
      return undefined;
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
