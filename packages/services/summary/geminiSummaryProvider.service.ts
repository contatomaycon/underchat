import { injectable } from 'tsyringe';
import { ISummaryProvider } from './ISummaryProvider';
import { executeSummaryOutboundHttp } from './summaryOutboundHttp.service';

interface GeminiSummaryResponse {
  readonly candidates?: ReadonlyArray<{
    readonly content?: {
      readonly parts?: ReadonlyArray<{
        readonly text?: unknown;
      }>;
    };
  }>;
}

@injectable()
export class GeminiSummaryProvider implements ISummaryProvider {
  async generateSummary(
    prompt: string,
    baseUrl: string,
    apiKey: string,
    model: string
  ): Promise<string> {
    const url = this.buildGenerateContentUrl(baseUrl, model);

    const response = await executeSummaryOutboundHttp({
      providerName: 'Gemini',
      url,
      headers: {
        'Content-Type': 'application/json',
        'x-goog-api-key': apiKey,
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
        },
      }),
    });

    if (response.statusCode < 200 || response.statusCode > 299) {
      throw new Error(
        `Gemini API request failed with status ${response.statusCode}.`
      );
    }

    let data: GeminiSummaryResponse;
    try {
      data = JSON.parse(
        response.body.toString('utf8')
      ) as GeminiSummaryResponse;
    } catch {
      throw new Error('Gemini API returned an invalid response.');
    }

    const summary = (data.candidates?.[0]?.content?.parts ?? [])
      .map((part) => (typeof part.text === 'string' ? part.text.trim() : ''))
      .filter((text) => text.length > 0)
      .join('\n')
      .trim();

    if (!summary) {
      throw new Error('Gemini API returned an empty summary.');
    }

    return summary;
  }

  private buildGenerateContentUrl(baseUrl: string, model: string): string {
    let parsedBaseUrl: URL;

    try {
      parsedBaseUrl = new URL(baseUrl.trim());
    } catch {
      throw new Error('Gemini API base URL is invalid.');
    }

    if (!['http:', 'https:'].includes(parsedBaseUrl.protocol)) {
      throw new Error('Gemini API base URL is invalid.');
    }

    const normalizedModel = this.normalizeModel(model);
    const pathSegments = parsedBaseUrl.pathname
      .split('/')
      .map((segment) => segment.trim())
      .filter((segment) => segment.length > 0);
    let versionIndex = -1;
    for (let index = pathSegments.length - 1; index >= 0; index -= 1) {
      if (/^v1(?:beta)+$|^v1$/i.test(pathSegments[index])) {
        versionIndex = index;
        break;
      }
    }
    const basePathSegments =
      versionIndex >= 0 ? pathSegments.slice(0, versionIndex) : pathSegments;

    parsedBaseUrl.pathname = `/${[
      ...basePathSegments,
      'v1beta',
      'models',
      `${encodeURIComponent(normalizedModel)}:generateContent`,
    ].join('/')}`;
    parsedBaseUrl.search = '';
    parsedBaseUrl.hash = '';

    return parsedBaseUrl.toString();
  }

  private normalizeModel(model: string): string {
    let normalizedModel = model.trim().replace(/^\/+/, '');

    while (/^models\//i.test(normalizedModel)) {
      normalizedModel = normalizedModel.slice('models/'.length);
    }

    if (!normalizedModel) {
      throw new Error('Gemini API model is required.');
    }

    return normalizedModel;
  }
}
