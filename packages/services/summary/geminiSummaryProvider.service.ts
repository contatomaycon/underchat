import { injectable } from 'tsyringe';
import { ISummaryProvider } from './ISummaryProvider';

@injectable()
export class GeminiSummaryProvider implements ISummaryProvider {
  async generateSummary(
    prompt: string,
    baseUrl: string,
    apiKey: string,
    model: string
  ): Promise<string> {
    let apiVersion = baseUrl;
    if (baseUrl.includes('/v1/')) {
      apiVersion = baseUrl.replace('/v1/', '/v1beta/');
    } else if (baseUrl.includes('/v1')) {
      apiVersion = baseUrl.replace('/v1', '/v1beta');
    } else if (!baseUrl.includes('/v1beta')) {
      apiVersion = baseUrl.replace(/\/$/, '') + '/v1beta';
    }

    const url = `${apiVersion}/models/${encodeURIComponent(
      model
    )}:generateContent?key=${encodeURIComponent(apiKey)}`;

    const response = await this.fetchWithRetry(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        contents: [
          {
            role: 'user',
            parts: [{ text: prompt }],
          },
        ],
        generationConfig: {
          maxOutputTokens: 2048,
          temperature: 0.3,
        },
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(
        `Gemini API error: ${response.status} - ${errorText} (URL: ${url.replace(apiKey, '***')})`
      );
    }

    const data = (await response.json()) as {
      candidates?: Array<{
        content?: {
          parts?: Array<{ text?: string }>;
        };
      }>;
    };

    return (
      data.candidates?.[0]?.content?.parts?.[0]?.text ||
      'Erro ao gerar sumário.'
    );
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
