import {
  resolveChatbotTemplate,
  resolveChatbotTemplateValue,
  selectChatbotApiResponsePaths,
  ChatbotVariableResolutionError,
} from '@core/common/functions/chatbotApiVariables';
import {
  executeSafeOutboundHttp,
  SAFE_OUTBOUND_HTTP_MAX_RESPONSE_BYTES,
  type ExecuteSafeOutboundHttpInput,
  type SafeOutboundHttpFailure,
  type SafeOutboundHttpResponse,
  type SafeOutboundHttpResponseHeaders,
} from '@core/common/functions/safeOutboundHttp';
import type {
  ApiRequestConfig,
  ApiRequestKeyValue,
  ApiRequestMultipartPart,
  ApiRequestProtectedValue,
} from '@core/schema/chatbot/chatbotFlow.schema';
import { randomBytes } from 'node:crypto';

export const CHATBOT_API_REQUEST_MAX_ITEMS = 20;
export const CHATBOT_API_REQUEST_MAX_CONCURRENCY = 3;
export const CHATBOT_API_REQUEST_MAX_ATTEMPTS = 3;
export const CHATBOT_API_REQUEST_MAX_HTTP_ATTEMPTS = 30;
export const CHATBOT_API_REQUEST_MAX_RETRY_AFTER_MS = 30_000;

const RETRYABLE_HTTP_STATUSES = new Set([408, 425, 429, 500, 502, 503, 504]);

const RETRYABLE_TRANSPORT_CODES = new Set([
  'dns_error',
  'network_error',
  'response_aborted',
  'response_error',
  'timeout',
]);

const JSON_CONTENT_TYPE_PATTERN = /(?:^|\/)json(?:$|;)|\+json(?:$|;)/iu;
const TEXT_CONTENT_TYPE_PATTERN =
  /^(?:text\/|application\/(?:javascript|x-www-form-urlencoded|xml)|[^;]+\+xml)/iu;
const TEMPLATE_PATTERN = /\{\{[\s\S]*?\}\}/u;
const UNSAFE_MULTIPART_VALUE_PATTERN = /[\r\n\u0000]/u;

export type ChatbotApiRequestExecutorErrorCode =
  | 'invalid_config'
  | 'invalid_url_template'
  | 'missing_secret'
  | 'secret_decryption_failed'
  | 'variable_resolution_failed'
  | 'invalid_json_body'
  | 'invalid_multipart_file'
  | 'invalid_items'
  | 'too_many_items'
  | 'http_status'
  | 'http_attempt_budget_exhausted'
  | 'skipped_fail_fast'
  | SafeOutboundHttpFailure['code'];

export interface ChatbotApiRequestExecutionError {
  readonly code: ChatbotApiRequestExecutorErrorCode;
  readonly message: string;
  readonly retryable: boolean;
}

export interface ChatbotApiRequestResponseMetadata {
  readonly status: number | null;
  readonly ok: boolean;
  readonly headers: SafeOutboundHttpResponseHeaders;
  readonly contentType: string | null;
  readonly sizeBytes: number;
  readonly durationMs: number;
  readonly attempts: number;
  readonly error?: ChatbotApiRequestExecutionError;
}

export interface ChatbotApiRequestItemResult {
  readonly index: number;
  readonly ok: boolean;
  readonly body: unknown;
  readonly response: ChatbotApiRequestResponseMetadata;
}

interface ChatbotApiRequestExecutionResultBase {
  readonly ok: boolean;
  readonly outputKey: string;
  readonly durationMs: number;
  readonly items: readonly ChatbotApiRequestItemResult[];
  readonly error?: ChatbotApiRequestExecutionError;
}

export interface ChatbotApiRequestOnceResult extends ChatbotApiRequestExecutionResultBase {
  readonly mode: 'once';
  readonly body: unknown;
  readonly response: ChatbotApiRequestResponseMetadata;
}

export interface ChatbotApiRequestForEachResult extends ChatbotApiRequestExecutionResultBase {
  readonly mode: 'forEach';
  readonly body: readonly unknown[];
  readonly response: readonly ChatbotApiRequestResponseMetadata[];
}

export type ChatbotApiRequestExecutionResult =
  ChatbotApiRequestOnceResult | ChatbotApiRequestForEachResult;

export interface ExecuteChatbotApiRequestInput {
  readonly config: ApiRequestConfig;
  readonly variables: Readonly<Record<string, unknown>>;
  readonly isProduction: boolean;
  readonly allowLocalhostHttp: boolean;
  /** Shared across retries and for-each items. Values are clamped to 1..30. */
  readonly maxHttpAttempts?: number;
  readonly captureAllResponseHeaders?: boolean;
}

export interface ChatbotApiRequestSecretDecryptor {
  decrypt(ciphertext: string): string;
}

export interface ChatbotApiRequestExecutorDependencies {
  readonly secretDecryptor?: ChatbotApiRequestSecretDecryptor;
  readonly executeHttp?: (
    input: ExecuteSafeOutboundHttpInput
  ) => Promise<SafeOutboundHttpResponse | SafeOutboundHttpFailure>;
  readonly sleep?: (milliseconds: number) => Promise<void>;
  readonly random?: () => number;
  readonly createMultipartBoundary?: () => string;
}

interface SerializedApiRequest {
  readonly url: string;
  readonly method: ApiRequestConfig['method'];
  readonly headers: Record<string, string | readonly string[]>;
  readonly sensitiveHeaderNames: readonly string[];
  readonly body?: Buffer;
  readonly idempotencyKey: string | null;
}

interface SerializedBody {
  readonly body?: Buffer;
  readonly contentType?: string;
}

interface MultipartFileValue {
  readonly body: Buffer;
  readonly fileName?: string;
  readonly contentType?: string;
}

interface HttpAttemptBudget {
  readonly limit: number;
  used: number;
}

class ChatbotApiRequestPreparationError extends Error {
  constructor(
    readonly code: Exclude<
      ChatbotApiRequestExecutorErrorCode,
      | 'http_status'
      | 'http_attempt_budget_exhausted'
      | 'skipped_fail_fast'
      | SafeOutboundHttpFailure['code']
    >,
    message: string
  ) {
    super(message);
    this.name = 'ChatbotApiRequestPreparationError';
  }
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const normalizePositiveInteger = (input: {
  value: number;
  maximum: number;
}): number => {
  const value = Number.isFinite(input.value) ? Math.floor(input.value) : 1;
  return Math.max(1, Math.min(value, input.maximum));
};

const normalizeRandom = (value: number): number =>
  Number.isFinite(value) ? Math.max(0, Math.min(value, 0.999999999999)) : 0.5;

const defaultSleep = (milliseconds: number): Promise<void> =>
  new Promise((resolve) => {
    const timeout = setTimeout(resolve, milliseconds);
    timeout.unref();
  });

const defaultMultipartBoundary = (): string =>
  `underchat-${randomBytes(18).toString('hex')}`;

const valueToString = (value: unknown): string => {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }
  const serialized = JSON.stringify(value);
  if (serialized === undefined) {
    throw new ChatbotApiRequestPreparationError(
      'invalid_config',
      'API request value cannot be serialized'
    );
  }
  return serialized;
};

const valuesToStrings = (value: unknown): string[] =>
  Array.isArray(value) ? value.map(valueToString) : [valueToString(value)];

const getHeader = (
  headers: Readonly<Record<string, string | readonly string[]>>,
  name: string
): string | undefined => {
  const value = headers[name.toLowerCase()];
  return typeof value === 'string' ? value : value?.[0];
};

const setHeader = (
  headers: Record<string, string | readonly string[]>,
  name: string,
  value: string | readonly string[]
): void => {
  const normalized = name.trim().toLowerCase();
  if (!normalized) {
    throw new ChatbotApiRequestPreparationError(
      'invalid_config',
      'API request header name cannot be empty'
    );
  }
  headers[normalized] = value;
};

const appendHeader = (
  headers: Record<string, string | readonly string[]>,
  name: string,
  values: readonly string[]
): void => {
  const normalized = name.trim().toLowerCase();
  if (!normalized) {
    throw new ChatbotApiRequestPreparationError(
      'invalid_config',
      'API request header name cannot be empty'
    );
  }
  const existing = headers[normalized];
  if (existing === undefined && values.length === 1) {
    headers[normalized] = values[0] ?? '';
    return;
  }
  const previous =
    existing === undefined
      ? []
      : typeof existing === 'string'
        ? [existing]
        : existing;
  headers[normalized] = [...previous, ...values];
};

const appendSearchParam = (url: URL, name: string, value: unknown): void => {
  if (!name.trim()) {
    throw new ChatbotApiRequestPreparationError(
      'invalid_config',
      'API request query parameter name cannot be empty'
    );
  }
  for (const item of valuesToStrings(value)) {
    url.searchParams.append(name, item);
  }
};

const responseHeaders = (
  headers: SafeOutboundHttpResponseHeaders,
  selectedNames: readonly string[]
): SafeOutboundHttpResponseHeaders => {
  const selected: SafeOutboundHttpResponseHeaders = Object.create(
    null
  ) as SafeOutboundHttpResponseHeaders;
  for (const rawName of selectedNames) {
    const name = rawName.trim().toLowerCase();
    const value = headers[name];
    if (name && value !== undefined) {
      selected[name] = Array.isArray(value) ? [...value] : value;
    }
  }
  return selected;
};

const contentTypeFromHeaders = (
  headers: SafeOutboundHttpResponseHeaders
): string | null => getHeader(headers, 'content-type') ?? null;

const decodeResponseBody = (
  body: Buffer,
  contentType: string | null
): unknown => {
  if (body.byteLength === 0) return null;
  const text = body.toString('utf8').replaceAll('\u0000', '\ufffd');
  const trimmed = text.trim();
  const looksJson =
    (trimmed.startsWith('{') && trimmed.endsWith('}')) ||
    (trimmed.startsWith('[') && trimmed.endsWith(']'));

  if (
    (contentType && JSON_CONTENT_TYPE_PATTERN.test(contentType)) ||
    looksJson
  ) {
    try {
      return JSON.parse(text) as unknown;
    } catch {
      return text;
    }
  }
  if (contentType && TEXT_CONTENT_TYPE_PATTERN.test(contentType)) return text;
  return body;
};

const captureResponseBody = (
  config: ApiRequestConfig,
  body: unknown
): unknown =>
  config.capture.mode === 'full'
    ? body
    : selectChatbotApiResponsePaths(body, config.capture.paths);

const parseRetryAfter = (
  value: string | undefined,
  nowMs: number
): number | null => {
  if (!value?.trim()) return null;
  const trimmed = value.trim();
  let delayMs: number;
  if (/^\d+$/u.test(trimmed)) {
    delayMs = Number(trimmed) * 1000;
  } else {
    const retryAt = Date.parse(trimmed);
    if (!Number.isFinite(retryAt)) return null;
    delayMs = Math.max(0, retryAt - nowMs);
  }
  if (!Number.isFinite(delayMs) || delayMs < 0) return null;
  return Math.min(Math.floor(delayMs), CHATBOT_API_REQUEST_MAX_RETRY_AFTER_MS);
};

const isRetryableTransportFailure = (
  result: SafeOutboundHttpFailure
): boolean => result.retryable && RETRYABLE_TRANSPORT_CODES.has(result.code);

const preparationFailure = (
  error: unknown
): ChatbotApiRequestExecutionError => {
  if (error instanceof ChatbotApiRequestPreparationError) {
    return { code: error.code, message: error.message, retryable: false };
  }
  if (error instanceof ChatbotVariableResolutionError) {
    return {
      code: 'variable_resolution_failed',
      message: 'A required API request variable is unavailable or invalid',
      retryable: false,
    };
  }
  return {
    code: 'invalid_config',
    message: 'API request configuration is invalid',
    retryable: false,
  };
};

const failedMetadata = (input: {
  error: ChatbotApiRequestExecutionError;
  durationMs: number;
  attempts: number;
}): ChatbotApiRequestResponseMetadata => ({
  status: null,
  ok: false,
  headers: {},
  contentType: null,
  sizeBytes: 0,
  durationMs: input.durationMs,
  attempts: input.attempts,
  error: input.error,
});

const skippedItem = (index: number): ChatbotApiRequestItemResult => ({
  index,
  ok: false,
  body: null,
  response: failedMetadata({
    attempts: 0,
    durationMs: 0,
    error: {
      code: 'skipped_fail_fast',
      message: 'API request item was skipped after an earlier failure',
      retryable: false,
    },
  }),
});

export class ChatbotApiRequestExecutorService {
  private readonly secretDecryptor?: ChatbotApiRequestSecretDecryptor;
  private readonly executeHttp: NonNullable<
    ChatbotApiRequestExecutorDependencies['executeHttp']
  >;
  private readonly sleep: NonNullable<
    ChatbotApiRequestExecutorDependencies['sleep']
  >;
  private readonly random: NonNullable<
    ChatbotApiRequestExecutorDependencies['random']
  >;
  private readonly createMultipartBoundary: NonNullable<
    ChatbotApiRequestExecutorDependencies['createMultipartBoundary']
  >;

  constructor(dependencies: ChatbotApiRequestExecutorDependencies = {}) {
    this.secretDecryptor = dependencies.secretDecryptor;
    this.executeHttp = dependencies.executeHttp ?? executeSafeOutboundHttp;
    this.sleep = dependencies.sleep ?? defaultSleep;
    this.random = dependencies.random ?? Math.random;
    this.createMultipartBoundary =
      dependencies.createMultipartBoundary ?? defaultMultipartBoundary;
  }

  public async execute(
    input: ExecuteChatbotApiRequestInput
  ): Promise<ChatbotApiRequestExecutionResult> {
    const startedAt = Date.now();
    const attemptBudget: HttpAttemptBudget = {
      limit: normalizePositiveInteger({
        value: input.maxHttpAttempts ?? CHATBOT_API_REQUEST_MAX_HTTP_ATTEMPTS,
        maximum: CHATBOT_API_REQUEST_MAX_HTTP_ATTEMPTS,
      }),
      used: 0,
    };
    if (input.config.execution.mode === 'once') {
      const item = await this.executeItem(
        input,
        input.variables,
        0,
        false,
        attemptBudget
      );
      return {
        mode: 'once',
        ok: item.ok,
        outputKey: input.config.outputKey,
        body: item.body,
        response: item.response,
        items: [item],
        durationMs: Math.max(0, Date.now() - startedAt),
      };
    }

    let sourceItems: readonly unknown[];
    try {
      sourceItems = this.resolveForEachItems(input.config, input.variables);
    } catch (error: unknown) {
      const preparedError = preparationFailure(error);
      return {
        mode: 'forEach',
        ok: false,
        outputKey: input.config.outputKey,
        body: [],
        response: [],
        items: [],
        error: preparedError,
        durationMs: Math.max(0, Date.now() - startedAt),
      };
    }

    const items = await this.executeForEach(input, sourceItems, attemptBudget);
    return {
      mode: 'forEach',
      ok: items.every((item) => item.ok),
      outputKey: input.config.outputKey,
      body: items.map((item) => item.body),
      response: items.map((item) => item.response),
      items,
      durationMs: Math.max(0, Date.now() - startedAt),
    };
  }

  private resolveForEachItems(
    config: ApiRequestConfig,
    variables: Readonly<Record<string, unknown>>
  ): readonly unknown[] {
    const resolved = resolveChatbotTemplate(
      config.execution.itemsExpression,
      variables,
      { arrayFormat: 'json', missingValue: 'error' }
    );
    let items = resolved;
    if (typeof items === 'string') {
      try {
        items = JSON.parse(items) as unknown;
      } catch {
        // The typed error below deliberately avoids reflecting input values.
      }
    }
    if (!Array.isArray(items)) {
      throw new ChatbotApiRequestPreparationError(
        'invalid_items',
        'For-each API request expression must resolve to an array'
      );
    }
    if (items.length > CHATBOT_API_REQUEST_MAX_ITEMS) {
      throw new ChatbotApiRequestPreparationError(
        'too_many_items',
        'For-each API request is limited to 20 items'
      );
    }
    return items;
  }

  private async executeForEach(
    input: ExecuteChatbotApiRequestInput,
    sourceItems: readonly unknown[],
    attemptBudget: HttpAttemptBudget
  ): Promise<ChatbotApiRequestItemResult[]> {
    if (sourceItems.length === 0) return [];
    const results: Array<ChatbotApiRequestItemResult | undefined> = Array.from({
      length: sourceItems.length,
    });
    const concurrency = normalizePositiveInteger({
      value: input.config.execution.concurrency,
      maximum: CHATBOT_API_REQUEST_MAX_CONCURRENCY,
    });
    let nextIndex = 0;
    let stopScheduling = false;

    const worker = async (): Promise<void> => {
      while (true) {
        if (stopScheduling || nextIndex >= sourceItems.length) return;
        const index = nextIndex;
        nextIndex += 1;
        const variables = {
          ...input.variables,
          item: sourceItems[index],
          index,
        };
        const result = await this.executeItem(
          input,
          variables,
          index,
          true,
          attemptBudget
        );
        results[index] = result;
        if (!result.ok && input.config.execution.failurePolicy === 'failFast') {
          stopScheduling = true;
        }
      }
    };

    await Promise.all(
      Array.from({ length: Math.min(concurrency, sourceItems.length) }, worker)
    );

    return results.map((result, index) => result ?? skippedItem(index));
  }

  private async executeItem(
    input: ExecuteChatbotApiRequestInput,
    variables: Readonly<Record<string, unknown>>,
    index: number,
    isForEach: boolean,
    attemptBudget: HttpAttemptBudget
  ): Promise<ChatbotApiRequestItemResult> {
    const startedAt = Date.now();
    let serialized: SerializedApiRequest;
    try {
      serialized = this.serializeRequest(
        input.config,
        variables,
        isForEach ? index : null
      );
    } catch (error: unknown) {
      const preparedError = preparationFailure(error);
      return {
        index,
        ok: false,
        body: null,
        response: failedMetadata({
          error: preparedError,
          attempts: 0,
          durationMs: Math.max(0, Date.now() - startedAt),
        }),
      };
    }

    const maximumAttempts = this.maximumAttempts(input.config, serialized);
    let attempts = 0;
    let lastResult: SafeOutboundHttpResponse | SafeOutboundHttpFailure | null =
      null;

    while (attempts < maximumAttempts) {
      if (!this.claimHttpAttempt(attemptBudget)) {
        if (lastResult) {
          return this.resultItem(
            index,
            input.config,
            lastResult,
            attempts,
            startedAt,
            input.captureAllResponseHeaders === true
          );
        }
        return {
          index,
          ok: false,
          body: null,
          response: failedMetadata({
            attempts: 0,
            durationMs: Math.max(0, Date.now() - startedAt),
            error: {
              code: 'http_attempt_budget_exhausted',
              message: 'API request HTTP attempt budget was exhausted',
              retryable: false,
            },
          }),
        };
      }
      attempts += 1;
      let result: SafeOutboundHttpResponse | SafeOutboundHttpFailure;
      try {
        result = await this.executeHttp({
          url: serialized.url,
          method: serialized.method,
          headers: serialized.headers,
          body: serialized.body,
          isProduction: input.isProduction,
          allowLocalhostHttp: input.allowLocalhostHttp,
          timeoutMs: input.config.execution.timeoutMs,
          responseLimitBytes: SAFE_OUTBOUND_HTTP_MAX_RESPONSE_BYTES,
          maxRedirects: 3,
          sensitiveHeaderNames: serialized.sensitiveHeaderNames,
        });
      } catch {
        result = {
          kind: 'failure',
          code: 'network_error',
          message: 'Outbound HTTP request failed',
          retryable: true,
          isTimeout: false,
          durationMs: 0,
        };
      }
      lastResult = result;

      const shouldRetry =
        attempts < maximumAttempts &&
        attemptBudget.used < attemptBudget.limit &&
        this.shouldRetryResult(result);
      if (shouldRetry) {
        await this.sleep(this.retryDelayMs(input.config, attempts, result));
        continue;
      }

      return this.resultItem(
        index,
        input.config,
        result,
        attempts,
        startedAt,
        input.captureAllResponseHeaders === true
      );
    }

    return {
      index,
      ok: false,
      body: null,
      response: failedMetadata({
        attempts,
        durationMs: Math.max(0, Date.now() - startedAt),
        error: {
          code: 'invalid_config',
          message: 'API request attempts could not be completed',
          retryable: false,
        },
      }),
    };
  }

  private claimHttpAttempt(budget: HttpAttemptBudget): boolean {
    if (budget.used >= budget.limit) return false;
    budget.used += 1;
    return true;
  }

  private resultItem(
    index: number,
    config: ApiRequestConfig,
    result: SafeOutboundHttpResponse | SafeOutboundHttpFailure,
    attempts: number,
    startedAt: number,
    captureAllResponseHeaders: boolean
  ): ChatbotApiRequestItemResult {
    return result.kind === 'failure'
      ? this.transportFailureItem(index, result, attempts, startedAt)
      : this.httpResponseItem(
          index,
          config,
          result,
          attempts,
          startedAt,
          captureAllResponseHeaders
        );
  }

  private maximumAttempts(
    config: ApiRequestConfig,
    request: SerializedApiRequest
  ): number {
    const configured = normalizePositiveInteger({
      value: config.execution.retry.maxAttempts,
      maximum: CHATBOT_API_REQUEST_MAX_ATTEMPTS,
    });
    if (
      (request.method === 'POST' || request.method === 'PATCH') &&
      !request.idempotencyKey
    ) {
      return 1;
    }
    return configured;
  }

  private shouldRetryResult(
    result: SafeOutboundHttpResponse | SafeOutboundHttpFailure
  ): boolean {
    return result.kind === 'failure'
      ? isRetryableTransportFailure(result)
      : RETRYABLE_HTTP_STATUSES.has(result.statusCode);
  }

  private retryDelayMs(
    config: ApiRequestConfig,
    attemptNumber: number,
    result: SafeOutboundHttpResponse | SafeOutboundHttpFailure
  ): number {
    const baseDelay = Math.min(
      CHATBOT_API_REQUEST_MAX_RETRY_AFTER_MS,
      config.execution.retry.initialDelayMs * 2 ** (attemptNumber - 1)
    );
    const jitter = Math.floor(
      baseDelay * (0.5 + normalizeRandom(this.random()) * 0.5)
    );
    if (result.kind === 'failure') return jitter;
    const retryAfter = parseRetryAfter(
      getHeader(result.headers, 'retry-after'),
      Date.now()
    );
    return Math.max(jitter, retryAfter ?? 0);
  }

  private transportFailureItem(
    index: number,
    failure: SafeOutboundHttpFailure,
    attempts: number,
    startedAt: number
  ): ChatbotApiRequestItemResult {
    const error: ChatbotApiRequestExecutionError = {
      code: failure.code,
      message: failure.message,
      retryable: failure.retryable,
    };
    return {
      index,
      ok: false,
      body: null,
      response: failedMetadata({
        error,
        attempts,
        durationMs: Math.max(0, Date.now() - startedAt),
      }),
    };
  }

  private httpResponseItem(
    index: number,
    config: ApiRequestConfig,
    response: SafeOutboundHttpResponse,
    attempts: number,
    startedAt: number,
    captureAllResponseHeaders: boolean
  ): ChatbotApiRequestItemResult {
    const contentType = contentTypeFromHeaders(response.headers);
    const decodedBody = decodeResponseBody(response.body, contentType);
    let body: unknown;
    try {
      body = captureResponseBody(config, decodedBody);
    } catch (error: unknown) {
      return {
        index,
        ok: false,
        body: null,
        response: {
          status: response.statusCode,
          ok: false,
          headers: captureAllResponseHeaders
            ? { ...response.headers }
            : responseHeaders(response.headers, config.capture.responseHeaders),
          contentType,
          sizeBytes: response.body.byteLength,
          durationMs: Math.max(0, Date.now() - startedAt),
          attempts,
          error: preparationFailure(error),
        },
      };
    }
    const ok = response.statusCode >= 200 && response.statusCode <= 299;
    const error: ChatbotApiRequestExecutionError | undefined = ok
      ? undefined
      : {
          code: 'http_status',
          message: `Outbound API returned HTTP ${response.statusCode}`,
          retryable: RETRYABLE_HTTP_STATUSES.has(response.statusCode),
        };
    return {
      index,
      ok,
      body,
      response: {
        status: response.statusCode,
        ok,
        headers: captureAllResponseHeaders
          ? { ...response.headers }
          : responseHeaders(response.headers, config.capture.responseHeaders),
        contentType,
        sizeBytes: response.body.byteLength,
        durationMs: Math.max(0, Date.now() - startedAt),
        attempts,
        ...(error ? { error } : {}),
      },
    };
  }

  private serializeRequest(
    config: ApiRequestConfig,
    variables: Readonly<Record<string, unknown>>,
    forEachIndex: number | null
  ): SerializedApiRequest {
    this.assertLiteralUrlAuthority(config.url);
    const resolvedUrl = this.resolveString(config.url, variables);
    let url: URL;
    try {
      url = new URL(resolvedUrl);
    } catch {
      throw new ChatbotApiRequestPreparationError(
        'invalid_config',
        'API request URL is invalid'
      );
    }

    for (const field of config.queryParams) {
      if (!field.enabled) continue;
      appendSearchParam(
        url,
        this.resolveString(field.key, variables),
        this.resolveKeyValue(field, variables)
      );
    }

    const headers: Record<string, string | readonly string[]> = Object.create(
      null
    ) as Record<string, string | readonly string[]>;
    const sensitiveHeaderNames = new Set<string>();
    for (const field of config.headers) {
      if (!field.enabled) continue;
      const name = this.resolveString(field.key, variables);
      appendHeader(
        headers,
        name,
        valuesToStrings(this.resolveKeyValue(field, variables))
      );
      if (field.sensitive) sensitiveHeaderNames.add(name.trim().toLowerCase());
    }

    this.applyAuthentication(
      config,
      variables,
      url,
      headers,
      sensitiveHeaderNames
    );
    const serializedBody = ['GET', 'HEAD', 'OPTIONS'].includes(config.method)
      ? {}
      : this.serializeBody(config, variables);
    if (serializedBody.contentType && !getHeader(headers, 'content-type')) {
      setHeader(headers, 'content-type', serializedBody.contentType);
    }
    if (config.body.type === 'multipart' && serializedBody.contentType) {
      setHeader(headers, 'content-type', serializedBody.contentType);
    }

    const configuredIdempotencyKey = this.resolveString(
      config.execution.idempotencyKey,
      variables
    ).trim();
    let idempotencyKey =
      configuredIdempotencyKey || getHeader(headers, 'idempotency-key') || '';
    if (idempotencyKey && forEachIndex !== null) {
      idempotencyKey = `${idempotencyKey}:${forEachIndex}`;
    }
    if (idempotencyKey) {
      setHeader(headers, 'idempotency-key', idempotencyKey);
    }

    return {
      url: url.toString(),
      method: config.method,
      headers,
      sensitiveHeaderNames: [...sensitiveHeaderNames],
      body: serializedBody.body,
      idempotencyKey: idempotencyKey || null,
    };
  }

  private assertLiteralUrlAuthority(template: string): void {
    const schemeEnd = template.indexOf('://');
    if (schemeEnd <= 0) {
      throw new ChatbotApiRequestPreparationError(
        'invalid_url_template',
        'API request URL scheme and host must be literal'
      );
    }
    const authorityStart = schemeEnd + 3;
    const suffix = template.slice(authorityStart);
    const relativeEnd = suffix.search(/[/?#]/u);
    const authorityEnd =
      relativeEnd < 0 ? template.length : authorityStart + relativeEnd;
    if (TEMPLATE_PATTERN.test(template.slice(0, authorityEnd))) {
      throw new ChatbotApiRequestPreparationError(
        'invalid_url_template',
        'API request URL scheme, host and port cannot use variables'
      );
    }
  }

  private resolveString(
    template: string,
    variables: Readonly<Record<string, unknown>>
  ): string {
    return valueToString(
      resolveChatbotTemplate(template, variables, {
        arrayFormat: 'json',
        missingValue: 'error',
      })
    );
  }

  private configuredValue(input: {
    value?: string;
    ciphertext?: string;
    hasValue?: boolean;
  }): string {
    const shouldDecrypt =
      Boolean(input.ciphertext) &&
      (input.value === undefined || (input.hasValue === true && !input.value));
    if (shouldDecrypt && input.ciphertext) {
      if (!this.secretDecryptor) {
        throw new ChatbotApiRequestPreparationError(
          'missing_secret',
          'Encrypted API request value cannot be resolved'
        );
      }
      try {
        return this.secretDecryptor.decrypt(input.ciphertext);
      } catch {
        throw new ChatbotApiRequestPreparationError(
          'secret_decryption_failed',
          'Encrypted API request value could not be decrypted'
        );
      }
    }
    if (input.hasValue && !input.value) {
      throw new ChatbotApiRequestPreparationError(
        'missing_secret',
        'Protected API request value is unavailable'
      );
    }
    if (input.value !== undefined) return input.value;
    return '';
  }

  private resolveProtectedValue(
    input: ApiRequestProtectedValue,
    variables: Readonly<Record<string, unknown>>
  ): unknown {
    return resolveChatbotTemplate(this.configuredValue(input), variables, {
      arrayFormat: 'json',
      missingValue: 'error',
    });
  }

  private resolveKeyValue(
    field: ApiRequestKeyValue,
    variables: Readonly<Record<string, unknown>>
  ): unknown {
    return resolveChatbotTemplate(this.configuredValue(field), variables, {
      arrayFormat: 'json',
      missingValue: 'error',
    });
  }

  private applyAuthentication(
    config: ApiRequestConfig,
    variables: Readonly<Record<string, unknown>>,
    url: URL,
    headers: Record<string, string | readonly string[]>,
    sensitiveHeaderNames: Set<string>
  ): void {
    if (config.auth.type === 'none') return;

    if (config.auth.type === 'bearer') {
      setHeader(
        headers,
        'authorization',
        `Bearer ${valueToString(
          this.resolveProtectedValue(config.auth.bearer.token, variables)
        )}`
      );
      sensitiveHeaderNames.add('authorization');
      return;
    }

    if (config.auth.type === 'basic') {
      const username = valueToString(
        this.resolveProtectedValue(config.auth.basic.username, variables)
      );
      const password = valueToString(
        this.resolveProtectedValue(config.auth.basic.password, variables)
      );
      setHeader(
        headers,
        'authorization',
        `Basic ${Buffer.from(`${username}:${password}`, 'utf8').toString(
          'base64'
        )}`
      );
      sensitiveHeaderNames.add('authorization');
      return;
    }

    const name = this.resolveString(config.auth.apiKey.name, variables);
    const value = this.resolveProtectedValue(
      config.auth.apiKey.value,
      variables
    );
    if (config.auth.apiKey.placement === 'query') {
      appendSearchParam(url, name, value);
      return;
    }
    const values = valuesToStrings(value);
    setHeader(headers, name, values.length === 1 ? (values[0] ?? '') : values);
    sensitiveHeaderNames.add(name.trim().toLowerCase());
  }

  private serializeBody(
    config: ApiRequestConfig,
    variables: Readonly<Record<string, unknown>>
  ): SerializedBody {
    switch (config.body.type) {
      case 'none':
        return {};
      case 'json':
        return this.serializeJsonBody(config, variables);
      case 'raw':
        return this.serializeRawBody(config, variables);
      case 'formUrlEncoded':
        return this.serializeFormBody(config, variables);
      case 'multipart':
        return this.serializeMultipartBody(config, variables);
    }
  }

  private bodyTemplate(
    config: ApiRequestConfig,
    property: 'json' | 'raw'
  ): string {
    const visibleValue = config.body[property];
    return this.configuredValue({
      value: visibleValue,
      ciphertext: config.body.ciphertext,
      hasValue: config.body.hasValue,
    });
  }

  private serializeJsonBody(
    config: ApiRequestConfig,
    variables: Readonly<Record<string, unknown>>
  ): SerializedBody {
    const template = this.bodyTemplate(config, 'json');
    let resolved: unknown;
    try {
      const parsed = JSON.parse(template) as unknown;
      resolved = resolveChatbotTemplateValue(parsed, variables, {
        arrayFormat: 'json',
        missingValue: 'error',
      });
    } catch (error: unknown) {
      if (error instanceof ChatbotVariableResolutionError) throw error;
      resolved = resolveChatbotTemplate(template, variables, {
        arrayFormat: 'json',
        missingValue: 'error',
      });
      if (typeof resolved === 'string') {
        try {
          resolved = JSON.parse(resolved) as unknown;
        } catch {
          throw new ChatbotApiRequestPreparationError(
            'invalid_json_body',
            'API request JSON body is invalid'
          );
        }
      }
    }

    let serialized: string | undefined;
    try {
      serialized = JSON.stringify(resolved);
    } catch {
      serialized = undefined;
    }
    if (serialized === undefined) {
      throw new ChatbotApiRequestPreparationError(
        'invalid_json_body',
        'API request JSON body cannot be serialized'
      );
    }
    return {
      body: Buffer.from(serialized, 'utf8'),
      contentType: 'application/json',
    };
  }

  private serializeRawBody(
    config: ApiRequestConfig,
    variables: Readonly<Record<string, unknown>>
  ): SerializedBody {
    const resolved = resolveChatbotTemplate(
      this.bodyTemplate(config, 'raw'),
      variables,
      { arrayFormat: 'json', missingValue: 'error' }
    );
    const body = Buffer.isBuffer(resolved)
      ? resolved
      : resolved instanceof Uint8Array
        ? Buffer.from(resolved)
        : Buffer.from(valueToString(resolved), 'utf8');
    return {
      body,
      contentType:
        config.body.contentType.trim() || 'text/plain; charset=utf-8',
    };
  }

  private serializeFormBody(
    config: ApiRequestConfig,
    variables: Readonly<Record<string, unknown>>
  ): SerializedBody {
    const form = new URLSearchParams();
    for (const field of config.body.formFields) {
      if (!field.enabled) continue;
      const name = this.resolveString(field.key, variables);
      if (!name.trim()) {
        throw new ChatbotApiRequestPreparationError(
          'invalid_config',
          'API request form field name cannot be empty'
        );
      }
      for (const value of valuesToStrings(
        this.resolveKeyValue(field, variables)
      )) {
        form.append(name, value);
      }
    }
    return {
      body: Buffer.from(form.toString(), 'utf8'),
      contentType: 'application/x-www-form-urlencoded',
    };
  }

  private serializeMultipartBody(
    config: ApiRequestConfig,
    variables: Readonly<Record<string, unknown>>
  ): SerializedBody {
    const boundary = this.createMultipartBoundary();
    if (!/^[\dA-Za-z'()+_,\-./:=?]{1,70}$/u.test(boundary)) {
      throw new ChatbotApiRequestPreparationError(
        'invalid_config',
        'Multipart boundary is invalid'
      );
    }
    const chunks: Buffer[] = [];
    for (const part of config.body.multipart) {
      if (!part.enabled) continue;
      const name = this.safeMultipartValue(
        this.resolveString(part.name, variables),
        'name'
      );
      chunks.push(Buffer.from(`--${boundary}\r\n`, 'utf8'));
      if (part.type === 'text') {
        chunks.push(
          Buffer.from(
            `Content-Disposition: form-data; name="${name}"\r\n\r\n`,
            'utf8'
          ),
          Buffer.from(
            valueToString(this.resolveMultipartValue(part, variables)),
            'utf8'
          ),
          Buffer.from('\r\n', 'utf8')
        );
        continue;
      }

      const file = this.resolveMultipartFile(part, variables);
      const configuredFileName = this.resolveString(part.fileName, variables);
      const configuredContentType = this.resolveString(
        part.contentType,
        variables
      );
      const fileName = this.safeMultipartValue(
        configuredFileName || file.fileName || 'file',
        'file name'
      );
      const contentType = this.safeMultipartValue(
        configuredContentType || file.contentType || 'application/octet-stream',
        'content type'
      );
      chunks.push(
        Buffer.from(
          `Content-Disposition: form-data; name="${name}"; filename="${fileName}"\r\nContent-Type: ${contentType}\r\n\r\n`,
          'utf8'
        ),
        file.body,
        Buffer.from('\r\n', 'utf8')
      );
    }
    chunks.push(Buffer.from(`--${boundary}--\r\n`, 'utf8'));
    return {
      body: Buffer.concat(chunks),
      contentType: `multipart/form-data; boundary=${boundary}`,
    };
  }

  private safeMultipartValue(value: string, field: string): string {
    if (!value || UNSAFE_MULTIPART_VALUE_PATTERN.test(value)) {
      throw new ChatbotApiRequestPreparationError(
        'invalid_config',
        `Multipart ${field} is invalid`
      );
    }
    return value.replaceAll('\\', '\\\\').replaceAll('"', '\\"');
  }

  private resolveMultipartValue(
    part: ApiRequestMultipartPart,
    variables: Readonly<Record<string, unknown>>
  ): unknown {
    return resolveChatbotTemplate(this.configuredValue(part), variables, {
      arrayFormat: 'json',
      missingValue: 'error',
    });
  }

  private resolveMultipartFile(
    part: ApiRequestMultipartPart,
    variables: Readonly<Record<string, unknown>>
  ): MultipartFileValue {
    const value = this.resolveMultipartValue(part, variables);
    if (Buffer.isBuffer(value)) return { body: value };
    if (value instanceof Uint8Array) return { body: Buffer.from(value) };
    if (typeof value === 'string') {
      const dataUri = /^data:([^;,]+)?(;base64)?,([\s\S]*)$/iu.exec(value);
      if (dataUri) {
        try {
          const encodedBody = dataUri[3] ?? '';
          if (
            dataUri[2] &&
            !this.isValidBase64(encodedBody.replaceAll(/\s/gu, ''))
          ) {
            throw new Error('invalid base64');
          }
          return {
            body: dataUri[2]
              ? Buffer.from(encodedBody, 'base64')
              : Buffer.from(decodeURIComponent(encodedBody), 'utf8'),
            ...(dataUri[1] ? { contentType: dataUri[1] } : {}),
          };
        } catch {
          throw new ChatbotApiRequestPreparationError(
            'invalid_multipart_file',
            'Multipart file data URI is invalid'
          );
        }
      }
      return { body: Buffer.from(value, 'utf8') };
    }
    if (!isRecord(value)) {
      throw new ChatbotApiRequestPreparationError(
        'invalid_multipart_file',
        'Multipart file value is invalid'
      );
    }

    const rawBody = value.body ?? value.data ?? value.content;
    let body: Buffer;
    if (Buffer.isBuffer(rawBody)) body = rawBody;
    else if (rawBody instanceof Uint8Array) body = Buffer.from(rawBody);
    else if (typeof rawBody === 'string') body = Buffer.from(rawBody, 'utf8');
    else if (typeof value.base64 === 'string') {
      const normalized = value.base64.replaceAll(/\s/gu, '');
      if (!this.isValidBase64(normalized)) {
        throw new ChatbotApiRequestPreparationError(
          'invalid_multipart_file',
          'Multipart base64 file value is invalid'
        );
      }
      body = Buffer.from(normalized, 'base64');
    } else {
      throw new ChatbotApiRequestPreparationError(
        'invalid_multipart_file',
        'Multipart file descriptor has no body'
      );
    }
    return {
      body,
      ...(typeof value.fileName === 'string'
        ? { fileName: value.fileName }
        : typeof value.filename === 'string'
          ? { fileName: value.filename }
          : {}),
      ...(typeof value.contentType === 'string'
        ? { contentType: value.contentType }
        : typeof value.mimeType === 'string'
          ? { contentType: value.mimeType }
          : {}),
    };
  }

  private isValidBase64(value: string): boolean {
    return /^(?:[\d+/A-Za-z]{4})*(?:[\d+/A-Za-z]{2}==|[\d+/A-Za-z]{3}=)?$/u.test(
      value
    );
  }
}
