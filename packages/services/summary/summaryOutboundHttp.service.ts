import {
  executeSafeOutboundHttp,
  type SafeOutboundHttpResponse,
} from '@core/common/functions/safeOutboundHttp';

export interface SummaryOutboundHttpInput {
  readonly providerName: 'Gemini' | 'OpenAI';
  readonly url: string;
  readonly headers: Readonly<Record<string, string>>;
  readonly body: string;
}

const MAX_ATTEMPTS = 3;
const TIMEOUT_MS = 30000;

const getOutboundPolicy = (): {
  isProduction: boolean;
  allowLocalhostHttp: boolean;
} => {
  const appEnvironment = process.env.APP_ENVIRONMENT?.trim().toLowerCase();
  const isProduction = appEnvironment
    ? !['local', 'dev', 'development', 'test'].includes(appEnvironment)
    : process.env.NODE_ENV?.trim().toLowerCase() === 'production';

  return {
    isProduction,
    allowLocalhostHttp: !isProduction,
  };
};

const isRetryableStatus = (statusCode: number): boolean =>
  statusCode === 429 || (statusCode >= 500 && statusCode <= 599);

const delayBeforeRetry = async (attempt: number): Promise<void> => {
  const delayMs = Math.min(1000 * 2 ** (attempt - 1), 5000);
  await new Promise<void>((resolve) => setTimeout(resolve, delayMs));
};

/**
 * Runs summary requests through the DNS-pinned outbound transport. Its timeout
 * covers DNS, request transmission and complete response-body consumption.
 */
export const executeSummaryOutboundHttp = async (
  input: SummaryOutboundHttpInput
): Promise<SafeOutboundHttpResponse> => {
  const policy = getOutboundPolicy();

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    let result;
    try {
      result = await executeSafeOutboundHttp({
        url: input.url,
        method: 'POST',
        headers: input.headers,
        body: input.body,
        isProduction: policy.isProduction,
        allowLocalhostHttp: policy.allowLocalhostHttp,
        timeoutMs: TIMEOUT_MS,
        sensitiveHeaderNames: ['authorization', 'x-goog-api-key'],
      });
    } catch {
      throw new Error(`${input.providerName} API request failed.`);
    }

    if (result.kind === 'failure') {
      if (result.isTimeout && attempt < MAX_ATTEMPTS) {
        await delayBeforeRetry(attempt);
        continue;
      }

      throw new Error(
        result.isTimeout
          ? `${input.providerName} API request timed out.`
          : `${input.providerName} API request failed.`
      );
    }

    if (isRetryableStatus(result.statusCode) && attempt < MAX_ATTEMPTS) {
      await delayBeforeRetry(attempt);
      continue;
    }

    return result;
  }

  throw new Error(`${input.providerName} API request failed.`);
};
