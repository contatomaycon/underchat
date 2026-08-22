import { EAiAgentType } from '@core/common/enums/EAiAgentType';
import { executeSafeOutboundHttp } from '@core/common/functions/safeOutboundHttp';

export const GEMINI_EMBEDDING_DIMENSION = 1536;

export const AI_PROVIDER_DEFAULT_BASE_URLS = {
  gpt: 'https://api.openai.com/v1',
  gemini: 'https://generativelanguage.googleapis.com/v1beta',
  deepseek: 'https://api.deepseek.com',
  others: null,
} as const;

export type AiProviderKind = 'gpt' | 'gemini' | 'deepseek' | 'others';

export type AiProviderErrorCode =
  | 'invalid_configuration'
  | 'invalid_request'
  | 'authentication_failed'
  | 'billing_required'
  | 'permission_denied'
  | 'model_or_endpoint_not_found'
  | 'rate_limited'
  | 'provider_unavailable'
  | 'request_timeout'
  | 'network_error'
  | 'invalid_response'
  | 'http_error';

export interface AiProviderConfiguration {
  readonly provider: string;
  readonly apiKey: string;
  readonly model: string;
  readonly baseUrl?: string | null;
  readonly embeddingModel?: string | null;
}

export interface NormalizedAiProviderConfiguration {
  readonly provider: AiProviderKind;
  readonly apiKey: string;
  readonly model: string;
  readonly baseUrl: string;
  readonly embeddingModel: string | null;
}

export interface AiProviderHistoryMetadata {
  readonly messageId?: string | null;
  readonly message_id?: string | null;
  readonly [key: string]: unknown;
}

export interface AiProviderHistoryMessage {
  readonly id?: string | null;
  readonly messageId?: string | null;
  readonly message_id?: string | null;
  readonly role: string;
  readonly content?: string | null;
  readonly metadata?: AiProviderHistoryMetadata | null;
}

export interface NormalizedAiProviderMessage {
  readonly role: 'system' | 'user' | 'assistant' | 'model';
  readonly content: string;
}

export interface NormalizeAiProviderHistoryInput {
  readonly provider: string;
  readonly history?: readonly AiProviderHistoryMessage[] | null;
  readonly question?: string | null;
  readonly excludeMessageId?: string | null;
}

export interface AiProviderTokenUsage {
  readonly inputTokens: number | null;
  readonly outputTokens: number | null;
  readonly totalTokens: number | null;
}

export interface AiProviderChatInput {
  readonly configuration: AiProviderConfiguration;
  readonly question: string;
  readonly history?: readonly AiProviderHistoryMessage[] | null;
  readonly excludeMessageId?: string | null;
  readonly systemPrompt?: string | null;
  readonly temperature?: number | null;
  readonly maxOutputTokens?: number | null;
}

export interface AiProviderChatResult {
  readonly content: string;
  readonly provider: AiProviderKind;
  readonly model: string;
  readonly baseUrl: string;
  readonly usage: AiProviderTokenUsage;
}

export interface GeminiEmbeddingInput {
  readonly configuration: AiProviderConfiguration;
  readonly texts: readonly string[];
}

export interface OpenAiCompatibleEmbeddingInput {
  readonly configuration: AiProviderConfiguration;
  readonly texts: readonly string[];
}

export interface AiProviderValidationResult {
  readonly valid: true;
  readonly provider: AiProviderKind;
  readonly model: string;
  readonly baseUrl: string;
  readonly latencyMs: number;
}

export interface AiProviderClientOptions {
  readonly fetchImpl?: typeof fetch;
  readonly safeOutboundHttpImpl?: typeof executeSafeOutboundHttp;
  readonly isProduction?: boolean;
  readonly allowLocalhostHttp?: boolean;
  readonly timeoutMs?: number;
  readonly maxAttempts?: number;
  readonly retryBaseDelayMs?: number;
  readonly maxRetryDelayMs?: number;
  readonly sleep?: (durationMs: number) => Promise<void>;
}

export interface ValidateAiProviderConfigurationInput {
  readonly configuration: AiProviderConfiguration;
  readonly client?: AiProviderClient;
}

interface ProviderRequest {
  readonly provider: AiProviderKind;
  readonly url: string;
  readonly init: RequestInit;
}

interface GeminiGenerateContentResponse {
  readonly candidates?: readonly {
    readonly content?: {
      readonly parts?: readonly {
        readonly text?: unknown;
      }[];
    };
  }[];
  readonly usageMetadata?: {
    readonly promptTokenCount?: unknown;
    readonly candidatesTokenCount?: unknown;
    readonly totalTokenCount?: unknown;
  };
}

interface OpenAiChatCompletionResponse {
  readonly choices?: readonly {
    readonly message?: {
      readonly content?: unknown;
    };
  }[];
  readonly usage?: {
    readonly prompt_tokens?: unknown;
    readonly completion_tokens?: unknown;
    readonly total_tokens?: unknown;
  };
}

interface GeminiBatchEmbeddingResponse {
  readonly embeddings?: unknown;
}

interface GeminiEmbeddingItem {
  readonly values?: unknown;
}

interface OpenAiCompatibleEmbeddingResponse {
  readonly data?: readonly {
    readonly index?: unknown;
    readonly embedding?: unknown;
  }[];
}

const PROVIDER_BY_ID = new Map<string, AiProviderKind>([
  [EAiAgentType.gpt, 'gpt'],
  [EAiAgentType.gemini, 'gemini'],
  [EAiAgentType.deepseek, 'deepseek'],
  [EAiAgentType.others, 'others'],
]);

const PROVIDER_BY_NAME = new Map<string, AiProviderKind>([
  ['gpt', 'gpt'],
  ['openai', 'gpt'],
  ['gemini', 'gemini'],
  ['google', 'gemini'],
  ['google-gemini', 'gemini'],
  ['deepseek', 'deepseek'],
  ['deep-seek', 'deepseek'],
  ['other', 'others'],
  ['others', 'others'],
  ['outro', 'others'],
  ['outros', 'others'],
  ['custom', 'others'],
]);

const STATUS_ERROR_DETAILS: Readonly<
  Record<
    number,
    {
      readonly code: AiProviderErrorCode;
      readonly message: string;
    }
  >
> = {
  400: {
    code: 'invalid_request',
    message:
      'O provedor rejeitou a requisição. Confira o modelo e os parâmetros configurados.',
  },
  401: {
    code: 'authentication_failed',
    message:
      'A autenticação no provedor falhou. Confira se a chave de API está correta e ativa.',
  },
  402: {
    code: 'billing_required',
    message:
      'O provedor recusou a cobrança. Confira os créditos e o faturamento da conta de API.',
  },
  403: {
    code: 'permission_denied',
    message:
      'A chave não tem permissão para usar esse modelo. Confira acesso, projeto e faturamento.',
  },
  404: {
    code: 'model_or_endpoint_not_found',
    message:
      'O modelo ou endpoint não foi encontrado. Confira o nome do modelo e a URL base.',
  },
  422: {
    code: 'invalid_configuration',
    message:
      'O provedor não aceitou a configuração. Confira modelo, URL base e parâmetros.',
  },
  429: {
    code: 'rate_limited',
    message:
      'O limite ou a cota da API foi atingido. Confira os créditos e tente novamente em instantes.',
  },
};

const DEFAULT_TIMEOUT_MS = 15_000;
const DEFAULT_MAX_ATTEMPTS = 3;
const DEFAULT_RETRY_BASE_DELAY_MS = 100;
const DEFAULT_MAX_RETRY_DELAY_MS = 2_000;

const RETRYABLE_NETWORK_ERROR_CODES = new Set([
  'EAI_AGAIN',
  'ECONNREFUSED',
  'ECONNRESET',
  'EHOSTUNREACH',
  'ENETDOWN',
  'ENETUNREACH',
  'ENOTFOUND',
  'EPIPE',
  'ETIMEDOUT',
  'UND_ERR_BODY_TIMEOUT',
  'UND_ERR_CONNECT',
  'UND_ERR_CONNECT_TIMEOUT',
  'UND_ERR_HEADERS_TIMEOUT',
  'UND_ERR_SOCKET',
]);

const SAFE_OUTBOUND_POLICY_FAILURE_CODES = new Set([
  'dns_blocked_address',
  'dns_invalid_address',
  'dns_non_loopback_address',
  'forbidden_header',
  'headers_too_large',
  'http_forbidden',
  'invalid_body',
  'invalid_header_name',
  'invalid_header_value',
  'invalid_method',
  'invalid_redirect',
  'invalid_url',
  'payload_too_large',
  'port_forbidden',
  'protocol_forbidden',
  'too_many_redirects',
  'url_credentials_forbidden',
  'url_fragment_forbidden',
]);

const isProductionRuntime = (): boolean => {
  const appEnvironment = process.env.APP_ENVIRONMENT?.trim().toLowerCase();

  if (appEnvironment) {
    return !['local', 'dev', 'development', 'test'].includes(appEnvironment);
  }

  return process.env.NODE_ENV?.trim().toLowerCase() === 'production';
};

class AiProviderRequestTimeoutError extends Error {
  constructor() {
    super('AI provider request timed out');
    this.name = 'AiProviderRequestTimeoutError';
  }
}

class AiProviderNetworkRequestError extends Error {
  constructor(readonly retryable: boolean) {
    super('AI provider network request failed');
    this.name = 'AiProviderNetworkRequestError';
  }
}

class AiProviderOutboundPolicyError extends Error {
  constructor() {
    super('AI provider endpoint was rejected by outbound policy');
    this.name = 'AiProviderOutboundPolicyError';
  }
}

/**
 * Sanitized provider error safe to expose through application error handling.
 * Raw response bodies, URLs and API keys are intentionally not retained.
 */
export class AiProviderError extends Error {
  readonly code: AiProviderErrorCode;
  readonly provider: AiProviderKind | null;
  readonly statusCode: number | null;
  readonly retryable: boolean;
  readonly retryAfterMs: number | null;

  constructor(options: {
    readonly code: AiProviderErrorCode;
    readonly message: string;
    readonly provider?: AiProviderKind | null;
    readonly statusCode?: number | null;
    readonly retryable?: boolean;
    readonly retryAfterMs?: number | null;
  }) {
    super(options.message);
    this.name = 'AiProviderError';
    this.code = options.code;
    this.provider = options.provider ?? null;
    this.statusCode = options.statusCode ?? null;
    this.retryable = options.retryable ?? false;
    this.retryAfterMs = options.retryAfterMs ?? null;
  }
}

const normalizeProviderName = (provider: string): string =>
  provider
    .trim()
    .toLocaleLowerCase('en-US')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');

/**
 * Resolves both database UUIDs and human-readable provider names.
 */
export const resolveAiProviderKind = (provider: string): AiProviderKind => {
  const trimmedProvider = provider.trim();
  const resolvedProvider =
    PROVIDER_BY_ID.get(trimmedProvider) ??
    PROVIDER_BY_NAME.get(normalizeProviderName(trimmedProvider));

  if (!resolvedProvider) {
    throw new AiProviderError({
      code: 'invalid_configuration',
      message:
        'Tipo de provedor de IA inválido. Use GPT, Gemini, DeepSeek ou Outros.',
    });
  }

  return resolvedProvider;
};

const createConfigurationError = (
  provider: AiProviderKind | null,
  message: string
): AiProviderError =>
  new AiProviderError({
    code: 'invalid_configuration',
    message,
    provider,
  });

const parseBaseUrl = (rawBaseUrl: string, provider: AiProviderKind): URL => {
  let parsedUrl: URL;

  try {
    parsedUrl = new URL(rawBaseUrl);
  } catch {
    throw createConfigurationError(
      provider,
      'A URL base do provedor é inválida.'
    );
  }

  if (!['http:', 'https:'].includes(parsedUrl.protocol)) {
    throw createConfigurationError(
      provider,
      'A URL base deve usar o protocolo HTTP ou HTTPS.'
    );
  }

  if (parsedUrl.username || parsedUrl.password) {
    throw createConfigurationError(
      provider,
      'A URL base não pode conter credenciais.'
    );
  }

  if (parsedUrl.search || parsedUrl.hash) {
    throw createConfigurationError(
      provider,
      'A URL base não pode conter query string ou fragmento.'
    );
  }

  return parsedUrl;
};

const normalizePathSegments = (pathname: string): string[] =>
  pathname
    .split('/')
    .map((segment) => segment.trim())
    .filter((segment) => segment.length > 0);

const normalizeGeminiPathSegments = (
  originalSegments: readonly string[]
): string[] => {
  const segments = [...originalSegments];
  let versionIndex = -1;

  for (let index = segments.length - 1; index >= 0; index -= 1) {
    const segment = segments[index];

    if (
      segment === 'v1' ||
      segment === 'v1beta' ||
      /^v1(?:beta){2,}$/i.test(segment)
    ) {
      versionIndex = index;
      break;
    }
  }

  if (versionIndex === -1) {
    segments.push('v1beta');
    return segments;
  }

  segments[versionIndex] = 'v1beta';

  if (
    versionIndex === segments.length - 2 &&
    segments[segments.length - 1]?.toLocaleLowerCase('en-US') === 'openai'
  ) {
    segments.pop();
  }

  return segments;
};

/**
 * Produces a canonical API base URL without duplicated separators or Gemini
 * version corruption such as `/v1betabeta`.
 */
export const normalizeAiProviderBaseUrl = (input: {
  readonly provider: string;
  readonly baseUrl?: string | null;
}): string => {
  const provider = resolveAiProviderKind(input.provider);
  const configuredBaseUrl = input.baseUrl?.trim();
  const defaultBaseUrl = AI_PROVIDER_DEFAULT_BASE_URLS[provider];
  const selectedBaseUrl = configuredBaseUrl || defaultBaseUrl;

  if (!selectedBaseUrl) {
    throw createConfigurationError(
      provider,
      'A URL base é obrigatória para provedores do tipo Outros.'
    );
  }

  const parsedUrl = parseBaseUrl(selectedBaseUrl, provider);
  const originalSegments = normalizePathSegments(parsedUrl.pathname);
  const normalizedSegments =
    provider === 'gemini'
      ? normalizeGeminiPathSegments(originalSegments)
      : originalSegments;

  parsedUrl.pathname =
    normalizedSegments.length > 0 ? `/${normalizedSegments.join('/')}` : '/';

  return parsedUrl.toString().replace(/\/$/, '');
};

const stripGeminiModelPrefix = (model: string): string => {
  let normalizedModel = model.trim().replace(/^\/+/, '');

  while (/^models\//i.test(normalizedModel)) {
    normalizedModel = normalizedModel.slice('models/'.length);
  }

  return normalizedModel;
};

/**
 * Normalizes a provider model while preserving valid current model names,
 * including legacy model identifiers that may still exist in stored records.
 */
export const normalizeAiProviderModel = (input: {
  readonly provider: string;
  readonly model: string;
}): string => {
  const provider = resolveAiProviderKind(input.provider);
  const normalizedModel =
    provider === 'gemini'
      ? stripGeminiModelPrefix(input.model)
      : input.model.trim();

  if (!normalizedModel) {
    throw createConfigurationError(
      provider,
      'O modelo do provedor de IA é obrigatório.'
    );
  }

  if (/[\u0000-\u001f\u007f]/.test(normalizedModel)) {
    throw createConfigurationError(
      provider,
      'O nome do modelo contém caracteres inválidos.'
    );
  }

  return normalizedModel;
};

/**
 * Validates and normalizes a complete provider configuration without making a
 * network request.
 */
export const normalizeAiProviderConfiguration = (
  configuration: AiProviderConfiguration
): NormalizedAiProviderConfiguration => {
  const provider = resolveAiProviderKind(configuration.provider);
  const apiKey = configuration.apiKey.trim();

  if (!apiKey) {
    throw createConfigurationError(
      provider,
      'A chave de API do provedor é obrigatória.'
    );
  }

  return {
    provider,
    apiKey,
    model: normalizeAiProviderModel({
      provider,
      model: configuration.model,
    }),
    baseUrl: normalizeAiProviderBaseUrl({
      provider,
      baseUrl: configuration.baseUrl,
    }),
    embeddingModel: configuration.embeddingModel?.trim()
      ? normalizeAiProviderModel({
          provider,
          model: configuration.embeddingModel,
        })
      : null,
  };
};

const messageIdentifier = (message: AiProviderHistoryMessage): string | null =>
  message.messageId ??
  message.message_id ??
  message.id ??
  message.metadata?.messageId ??
  message.metadata?.message_id ??
  null;

const normalizeMessageRole = (
  provider: AiProviderKind,
  rawRole: string
): NormalizedAiProviderMessage['role'] | null => {
  const role = rawRole.trim().toLocaleLowerCase('en-US');

  if (role === 'user' || role === 'human') {
    return 'user';
  }

  if (role === 'assistant' || role === 'model' || role === 'ai') {
    return provider === 'gemini' ? 'model' : 'assistant';
  }

  if (role === 'system') {
    return provider === 'gemini' ? null : 'system';
  }

  return null;
};

const mergeConsecutiveMessages = (
  messages: readonly NormalizedAiProviderMessage[]
): NormalizedAiProviderMessage[] => {
  const mergedMessages: NormalizedAiProviderMessage[] = [];

  for (const message of messages) {
    const previousMessage = mergedMessages[mergedMessages.length - 1];

    if (previousMessage?.role === message.role) {
      mergedMessages[mergedMessages.length - 1] = {
        role: previousMessage.role,
        content: `${previousMessage.content}\n${message.content}`,
      };
      continue;
    }

    mergedMessages.push(message);
  }

  return mergedMessages;
};

/**
 * Normalizes provider history, removes empty/excluded messages, coalesces
 * consecutive roles and appends the current question at most once.
 */
export const normalizeAiProviderHistory = (
  input: NormalizeAiProviderHistoryInput
): NormalizedAiProviderMessage[] => {
  const provider = resolveAiProviderKind(input.provider);
  const excludedMessageId = input.excludeMessageId?.trim() || null;
  const normalizedMessages: NormalizedAiProviderMessage[] = [];
  let isQuestionAlreadyLastUserMessage = false;
  const normalizedQuestion = input.question?.trim() ?? '';

  for (const historyMessage of input.history ?? []) {
    if (
      excludedMessageId &&
      messageIdentifier(historyMessage) === excludedMessageId
    ) {
      continue;
    }

    const role = normalizeMessageRole(provider, historyMessage.role);
    const content = historyMessage.content?.trim() ?? '';

    if (!role || !content) {
      continue;
    }

    normalizedMessages.push({ role, content });
  }

  if (
    normalizedQuestion &&
    normalizedMessages[normalizedMessages.length - 1]?.role === 'user' &&
    normalizedMessages[normalizedMessages.length - 1]?.content ===
      normalizedQuestion
  ) {
    isQuestionAlreadyLastUserMessage = true;
  }

  if (provider === 'gemini') {
    while (normalizedMessages[0]?.role === 'model') {
      normalizedMessages.shift();
    }
  }

  const mergedMessages = mergeConsecutiveMessages(normalizedMessages);

  if (!normalizedQuestion || isQuestionAlreadyLastUserMessage) {
    return mergedMessages;
  }

  const previousMessage = mergedMessages[mergedMessages.length - 1];

  if (previousMessage?.role === 'user') {
    mergedMessages[mergedMessages.length - 1] = {
      role: 'user',
      content: `${previousMessage.content}\n${normalizedQuestion}`,
    };
  } else {
    mergedMessages.push({
      role: 'user',
      content: normalizedQuestion,
    });
  }

  return mergedMessages;
};

const joinApiPath = (baseUrl: string, path: string): string =>
  `${baseUrl.replace(/\/+$/, '')}/${path.replace(/^\/+/, '')}`;

const finiteTokenCount = (value: unknown): number | null =>
  typeof value === 'number' && Number.isFinite(value) ? value : null;

const emptyTokenUsage = (): AiProviderTokenUsage => ({
  inputTokens: null,
  outputTokens: null,
  totalTokens: null,
});

const readTextParts = (
  parts: readonly {
    readonly text?: unknown;
  }[]
): string =>
  parts
    .map((part) => (typeof part.text === 'string' ? part.text.trim() : ''))
    .filter((text) => text.length > 0)
    .join('\n')
    .trim();

const readOpenAiContent = (content: unknown): string => {
  if (typeof content === 'string') {
    return content.trim();
  }

  if (!Array.isArray(content)) {
    return '';
  }

  const textParts: string[] = [];

  for (const part of content) {
    if (
      typeof part === 'object' &&
      part !== null &&
      'text' in part &&
      typeof part.text === 'string'
    ) {
      const text = part.text.trim();

      if (text) {
        textParts.push(text);
      }
    }
  }

  return textParts.join('\n').trim();
};

const parseRetryAfterMs = (response: Response): number | null => {
  const retryAfter = response.headers.get('retry-after')?.trim();

  if (!retryAfter) {
    return null;
  }

  const seconds = Number(retryAfter);

  if (Number.isFinite(seconds) && seconds >= 0) {
    return seconds * 1_000;
  }

  const retryAt = Date.parse(retryAfter);

  if (!Number.isFinite(retryAt)) {
    return null;
  }

  return Math.max(0, retryAt - Date.now());
};

const readProviderErrorIdentifiers = async (
  response: Response
): Promise<Set<string>> => {
  let payload: unknown;
  try {
    payload = await response.clone().json();
  } catch {
    return new Set();
  }

  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    return new Set();
  }

  const identifiers = new Set<string>();
  const append = (value: unknown): void => {
    if (typeof value === 'string' && value.trim()) {
      identifiers.add(value.trim().toUpperCase());
    }
  };
  const root = payload as Record<string, unknown>;
  append(root.code);
  append(root.status);

  const error =
    root.error && typeof root.error === 'object' && !Array.isArray(root.error)
      ? (root.error as Record<string, unknown>)
      : null;
  if (error) {
    append(error.code);
    append(error.type);
    append(error.status);

    if (Array.isArray(error.details)) {
      for (const detail of error.details) {
        if (detail && typeof detail === 'object' && !Array.isArray(detail)) {
          const detailRecord = detail as Record<string, unknown>;
          append(detailRecord.code);
          append(detailRecord.reason);
          append(detailRecord.status);
        }
      }
    }
  }

  return identifiers;
};

const createHttpError = async (
  provider: AiProviderKind,
  response: Response
): Promise<AiProviderError> => {
  const identifiers = await readProviderErrorIdentifiers(response);
  if (
    identifiers.has('API_KEY_INVALID') ||
    identifiers.has('INVALID_API_KEY')
  ) {
    return new AiProviderError({
      code: 'authentication_failed',
      message:
        'A autenticação no provedor falhou. Confira se a chave de API está correta e ativa.',
      provider,
      statusCode: response.status,
    });
  }

  if (
    identifiers.has('INSUFFICIENT_QUOTA') ||
    identifiers.has('BILLING_HARD_LIMIT_REACHED') ||
    identifiers.has('BILLING_NOT_ACTIVE')
  ) {
    return new AiProviderError({
      code: 'billing_required',
      message:
        'O provedor recusou a cobrança. Confira os créditos e o faturamento da conta de API.',
      provider,
      statusCode: response.status,
    });
  }

  const knownError = STATUS_ERROR_DETAILS[response.status];
  const isServerError = response.status >= 500 && response.status <= 599;

  if (knownError) {
    return new AiProviderError({
      code: knownError.code,
      message: knownError.message,
      provider,
      statusCode: response.status,
      retryable: response.status === 429,
      retryAfterMs:
        response.status === 429 ? parseRetryAfterMs(response) : null,
    });
  }

  if (isServerError) {
    return new AiProviderError({
      code: 'provider_unavailable',
      message:
        'O provedor de IA está temporariamente indisponível. Tente novamente em instantes.',
      provider,
      statusCode: response.status,
      retryable: true,
    });
  }

  return new AiProviderError({
    code: 'http_error',
    message:
      'O provedor de IA recusou a requisição. Confira a configuração e tente novamente.',
    provider,
    statusCode: response.status,
  });
};

const normalizeRequestError = (
  provider: AiProviderKind,
  error: unknown
): AiProviderError => {
  if (error instanceof AiProviderError) {
    return error;
  }

  if (error instanceof AiProviderRequestTimeoutError) {
    return new AiProviderError({
      code: 'request_timeout',
      message:
        'O provedor de IA demorou demais para responder. Tente novamente em instantes.',
      provider,
      retryable: true,
    });
  }

  if (error instanceof AiProviderOutboundPolicyError) {
    return new AiProviderError({
      code: 'invalid_configuration',
      message:
        'A URL do provedor foi bloqueada pela política de segurança. Use um endpoint HTTPS público na porta 443.',
      provider,
    });
  }

  if (error instanceof AiProviderNetworkRequestError) {
    return new AiProviderError({
      code: 'network_error',
      message:
        'Não foi possível comunicar com o provedor de IA. Confira a URL e a conectividade.',
      provider,
      retryable: error.retryable,
    });
  }

  return new AiProviderError({
    code: 'network_error',
    message:
      'Não foi possível comunicar com o provedor de IA. Confira a URL e a conectividade.',
    provider,
    retryable: isRetryableNetworkError(error),
  });
};

const readErrorCode = (error: unknown, depth = 0): string | null => {
  if (
    depth > 2 ||
    typeof error !== 'object' ||
    error === null ||
    Array.isArray(error)
  ) {
    return null;
  }

  if (
    'code' in error &&
    (typeof error.code === 'string' || typeof error.code === 'number')
  ) {
    return String(error.code).trim().toUpperCase();
  }

  return 'cause' in error ? readErrorCode(error.cause, depth + 1) : null;
};

const isRetryableNetworkError = (error: unknown): boolean => {
  if (error instanceof TypeError) {
    return true;
  }

  const errorCode = readErrorCode(error);
  return errorCode !== null && RETRYABLE_NETWORK_ERROR_CODES.has(errorCode);
};

const isGpt5Model = (model: string): boolean =>
  /(?:^|[/:])gpt-5(?:[.-]|$)/i.test(model.trim());

const assertPositiveInteger = (
  value: number | null | undefined,
  provider: AiProviderKind,
  fieldName: string
): number | undefined => {
  if (value === null || value === undefined) {
    return undefined;
  }

  if (!Number.isInteger(value) || value <= 0) {
    throw createConfigurationError(
      provider,
      `${fieldName} deve ser um número inteiro positivo.`
    );
  }

  return value;
};

const assertTemperature = (
  value: number | null | undefined,
  provider: AiProviderKind
): number | undefined => {
  if (value === null || value === undefined) {
    return undefined;
  }

  if (!Number.isFinite(value) || value < 0 || value > 2) {
    throw createConfigurationError(
      provider,
      'A temperatura deve estar entre 0 e 2.'
    );
  }

  return value;
};

const defaultSleep = async (durationMs: number): Promise<void> => {
  await new Promise<void>((resolve) => {
    setTimeout(resolve, durationMs);
  });
};

/**
 * Central HTTP client for native Gemini and OpenAI-compatible providers.
 */
export class AiProviderClient {
  private readonly fetchImpl: typeof fetch;
  private readonly safeOutboundHttpImpl: typeof executeSafeOutboundHttp;
  private readonly isProduction: boolean;
  private readonly allowLocalhostHttp: boolean;
  private readonly timeoutMs: number;
  private readonly maxAttempts: number;
  private readonly retryBaseDelayMs: number;
  private readonly maxRetryDelayMs: number;
  private readonly sleep: (durationMs: number) => Promise<void>;

  constructor(options: AiProviderClientOptions = {}) {
    this.fetchImpl = options.fetchImpl ?? globalThis.fetch.bind(globalThis);
    this.safeOutboundHttpImpl =
      options.safeOutboundHttpImpl ?? executeSafeOutboundHttp;
    this.isProduction = options.isProduction ?? isProductionRuntime();
    this.allowLocalhostHttp =
      !this.isProduction && (options.allowLocalhostHttp ?? false);
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.maxAttempts = options.maxAttempts ?? DEFAULT_MAX_ATTEMPTS;
    this.retryBaseDelayMs =
      options.retryBaseDelayMs ?? DEFAULT_RETRY_BASE_DELAY_MS;
    this.maxRetryDelayMs =
      options.maxRetryDelayMs ?? DEFAULT_MAX_RETRY_DELAY_MS;
    this.sleep = options.sleep ?? defaultSleep;

    if (!Number.isFinite(this.timeoutMs) || this.timeoutMs <= 0) {
      throw createConfigurationError(
        null,
        'O timeout do cliente de IA deve ser positivo.'
      );
    }

    if (!Number.isInteger(this.maxAttempts) || this.maxAttempts <= 0) {
      throw createConfigurationError(
        null,
        'A quantidade de tentativas do cliente de IA deve ser positiva.'
      );
    }

    if (
      !Number.isFinite(this.retryBaseDelayMs) ||
      this.retryBaseDelayMs < 0 ||
      !Number.isFinite(this.maxRetryDelayMs) ||
      this.maxRetryDelayMs < 0
    ) {
      throw createConfigurationError(
        null,
        'Os intervalos de retry do cliente de IA não podem ser negativos.'
      );
    }
  }

  /**
   * Generates one chat response using native Gemini or an OpenAI-compatible
   * `/chat/completions` endpoint.
   */
  async generateChat(
    input: AiProviderChatInput
  ): Promise<AiProviderChatResult> {
    const configuration = normalizeAiProviderConfiguration(input.configuration);
    const question = input.question.trim();

    if (!question) {
      throw createConfigurationError(
        configuration.provider,
        'A pergunta para o provedor de IA é obrigatória.'
      );
    }

    const history = normalizeAiProviderHistory({
      provider: configuration.provider,
      history: input.history,
      question,
      excludeMessageId: input.excludeMessageId,
    });
    const temperature = assertTemperature(
      input.temperature,
      configuration.provider
    );
    const maxOutputTokens = assertPositiveInteger(
      input.maxOutputTokens,
      configuration.provider,
      'O limite de tokens'
    );

    if (configuration.provider === 'gemini') {
      return this.generateGeminiChat({
        configuration,
        history,
        systemPrompt: input.systemPrompt,
        temperature,
        maxOutputTokens,
      });
    }

    return this.generateOpenAiCompatibleChat({
      configuration,
      history,
      systemPrompt: input.systemPrompt,
      temperature,
      maxOutputTokens,
    });
  }

  /**
   * Executes a minimal real chat request suitable for create/activate
   * configuration validation.
   */
  async validateConfiguration(
    configurationInput: AiProviderConfiguration
  ): Promise<AiProviderValidationResult> {
    const startedAt = Date.now();
    const result = await this.generateChat({
      configuration: configurationInput,
      systemPrompt:
        'You are validating an API integration. Answer with the word OK only.',
      question: 'OK',
    });

    return {
      valid: true,
      provider: result.provider,
      model: result.model,
      baseUrl: result.baseUrl,
      latencyMs: Date.now() - startedAt,
    };
  }

  /**
   * Generates native Gemini batch embeddings with an exact 1536-dimensional
   * contract. Stored legacy identifiers are normalized and then validated by
   * the provider before use.
   */
  async generateGeminiEmbeddings(
    input: GeminiEmbeddingInput
  ): Promise<number[][]> {
    const configuration = normalizeAiProviderConfiguration(input.configuration);

    if (configuration.provider !== 'gemini') {
      throw createConfigurationError(
        configuration.provider,
        'Embeddings nativos do Gemini exigem um agente do tipo Gemini.'
      );
    }

    if (!configuration.embeddingModel) {
      throw createConfigurationError(
        configuration.provider,
        'O modelo de embedding do Gemini é obrigatório.'
      );
    }

    if (input.texts.length === 0) {
      return [];
    }

    const texts = input.texts.map((text) => text.trim());

    if (texts.some((text) => text.length === 0)) {
      throw createConfigurationError(
        configuration.provider,
        'Os textos para embedding não podem estar vazios.'
      );
    }

    const modelReference = `models/${configuration.embeddingModel}`;
    const response = await this.requestJson<GeminiBatchEmbeddingResponse>({
      provider: configuration.provider,
      url: joinApiPath(
        configuration.baseUrl,
        `models/${encodeURIComponent(
          configuration.embeddingModel
        )}:batchEmbedContents`
      ),
      init: {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-goog-api-key': configuration.apiKey,
        },
        body: JSON.stringify({
          requests: texts.map((text) => ({
            model: modelReference,
            content: {
              parts: [{ text }],
            },
            outputDimensionality: GEMINI_EMBEDDING_DIMENSION,
          })),
        }),
      },
    });

    return this.validateGeminiEmbeddings(
      response,
      texts.length,
      configuration.provider
    );
  }

  /**
   * Generates embeddings through an OpenAI-compatible `/embeddings` endpoint
   * using the same outbound URL policy, timeout and retry rules as chat calls.
   */
  async generateOpenAiCompatibleEmbeddings(
    input: OpenAiCompatibleEmbeddingInput
  ): Promise<number[][]> {
    const configuration = normalizeAiProviderConfiguration(input.configuration);

    if (configuration.provider === 'gemini') {
      throw createConfigurationError(
        configuration.provider,
        'Embeddings do Gemini devem usar o endpoint nativo do provedor.'
      );
    }

    if (!configuration.embeddingModel) {
      throw createConfigurationError(
        configuration.provider,
        'O modelo de embedding é obrigatório.'
      );
    }

    if (input.texts.length === 0) {
      return [];
    }

    const texts = input.texts.map((text) => text.trim());
    if (texts.some((text) => text.length === 0)) {
      throw createConfigurationError(
        configuration.provider,
        'Os textos para embedding não podem estar vazios.'
      );
    }

    const response = await this.requestJson<OpenAiCompatibleEmbeddingResponse>({
      provider: configuration.provider,
      url: joinApiPath(configuration.baseUrl, 'embeddings'),
      init: {
        method: 'POST',
        headers: {
          authorization: `Bearer ${configuration.apiKey}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          model: configuration.embeddingModel,
          input: texts,
          ...(configuration.embeddingModel.startsWith('text-embedding-3-')
            ? { dimensions: GEMINI_EMBEDDING_DIMENSION }
            : {}),
        }),
      },
    });

    return this.validateOpenAiCompatibleEmbeddings(
      response,
      texts.length,
      configuration.provider
    );
  }

  private async generateGeminiChat(input: {
    readonly configuration: NormalizedAiProviderConfiguration;
    readonly history: readonly NormalizedAiProviderMessage[];
    readonly systemPrompt?: string | null;
    readonly temperature?: number;
    readonly maxOutputTokens?: number;
  }): Promise<AiProviderChatResult> {
    const generationConfig: Record<string, number> = {};
    const supportsTemperature = !/^gemini-3(?:[.-]|$)/i.test(
      input.configuration.model
    );

    if (input.temperature !== undefined && supportsTemperature) {
      generationConfig.temperature = input.temperature;
    }

    if (input.maxOutputTokens !== undefined) {
      generationConfig.maxOutputTokens = input.maxOutputTokens;
    }

    const systemPrompt = input.systemPrompt?.trim();
    const response = await this.requestJson<GeminiGenerateContentResponse>({
      provider: input.configuration.provider,
      url: joinApiPath(
        input.configuration.baseUrl,
        `models/${encodeURIComponent(
          input.configuration.model
        )}:generateContent`
      ),
      init: {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-goog-api-key': input.configuration.apiKey,
        },
        body: JSON.stringify({
          ...(systemPrompt
            ? {
                system_instruction: {
                  parts: [{ text: systemPrompt }],
                },
              }
            : {}),
          contents: input.history.map((message) => ({
            role: message.role,
            parts: [{ text: message.content }],
          })),
          ...(Object.keys(generationConfig).length > 0
            ? { generationConfig }
            : {}),
        }),
      },
    });

    const content = readTextParts(
      response.candidates?.[0]?.content?.parts ?? []
    );

    if (!content) {
      throw new AiProviderError({
        code: 'invalid_response',
        message:
          'O Gemini não retornou conteúdo. Confira as políticas de segurança e o modelo configurado.',
        provider: input.configuration.provider,
      });
    }

    return {
      content,
      provider: input.configuration.provider,
      model: input.configuration.model,
      baseUrl: input.configuration.baseUrl,
      usage: {
        inputTokens: finiteTokenCount(response.usageMetadata?.promptTokenCount),
        outputTokens: finiteTokenCount(
          response.usageMetadata?.candidatesTokenCount
        ),
        totalTokens: finiteTokenCount(response.usageMetadata?.totalTokenCount),
      },
    };
  }

  private async generateOpenAiCompatibleChat(input: {
    readonly configuration: NormalizedAiProviderConfiguration;
    readonly history: readonly NormalizedAiProviderMessage[];
    readonly systemPrompt?: string | null;
    readonly temperature?: number;
    readonly maxOutputTokens?: number;
  }): Promise<AiProviderChatResult> {
    const systemPrompt = input.systemPrompt?.trim();
    const supportsTemperature = !isGpt5Model(input.configuration.model);
    const response = await this.requestJson<OpenAiChatCompletionResponse>({
      provider: input.configuration.provider,
      url: joinApiPath(input.configuration.baseUrl, 'chat/completions'),
      init: {
        method: 'POST',
        headers: {
          authorization: `Bearer ${input.configuration.apiKey}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          model: input.configuration.model,
          messages: [
            ...(systemPrompt
              ? [{ role: 'system' as const, content: systemPrompt }]
              : []),
            ...input.history.map((message) => ({
              role: message.role,
              content: message.content,
            })),
          ],
          ...(input.temperature !== undefined && supportsTemperature
            ? { temperature: input.temperature }
            : {}),
          ...(input.maxOutputTokens !== undefined
            ? input.configuration.provider === 'gpt'
              ? { max_completion_tokens: input.maxOutputTokens }
              : { max_tokens: input.maxOutputTokens }
            : {}),
        }),
      },
    });

    const content = readOpenAiContent(response.choices?.[0]?.message?.content);

    if (!content) {
      throw new AiProviderError({
        code: 'invalid_response',
        message:
          'O provedor de IA não retornou conteúdo. Confira o modelo e as políticas configuradas.',
        provider: input.configuration.provider,
      });
    }

    const usage = response.usage;

    return {
      content,
      provider: input.configuration.provider,
      model: input.configuration.model,
      baseUrl: input.configuration.baseUrl,
      usage: usage
        ? {
            inputTokens: finiteTokenCount(usage.prompt_tokens),
            outputTokens: finiteTokenCount(usage.completion_tokens),
            totalTokens: finiteTokenCount(usage.total_tokens),
          }
        : emptyTokenUsage(),
    };
  }

  private validateGeminiEmbeddings(
    response: GeminiBatchEmbeddingResponse,
    expectedCount: number,
    provider: AiProviderKind
  ): number[][] {
    if (
      !Array.isArray(response.embeddings) ||
      response.embeddings.length !== expectedCount
    ) {
      throw new AiProviderError({
        code: 'invalid_response',
        message: 'O Gemini retornou uma quantidade inesperada de embeddings.',
        provider,
      });
    }

    return response.embeddings.map((embedding, embeddingIndex) => {
      if (
        typeof embedding !== 'object' ||
        embedding === null ||
        !('values' in embedding)
      ) {
        throw new AiProviderError({
          code: 'invalid_response',
          message: `O embedding ${embeddingIndex + 1} retornado pelo Gemini é inválido.`,
          provider,
        });
      }

      const values = (embedding as GeminiEmbeddingItem).values;

      if (
        !Array.isArray(values) ||
        values.length !== GEMINI_EMBEDDING_DIMENSION ||
        !values.every(
          (value) => typeof value === 'number' && Number.isFinite(value)
        )
      ) {
        throw new AiProviderError({
          code: 'invalid_response',
          message: `O embedding ${embeddingIndex + 1} deve conter exatamente ${GEMINI_EMBEDDING_DIMENSION} números finitos.`,
          provider,
        });
      }

      return values;
    });
  }

  private validateOpenAiCompatibleEmbeddings(
    response: OpenAiCompatibleEmbeddingResponse,
    expectedCount: number,
    provider: AiProviderKind
  ): number[][] {
    if (
      !Array.isArray(response.data) ||
      response.data.length !== expectedCount
    ) {
      throw new AiProviderError({
        code: 'invalid_response',
        message: 'O provedor retornou uma quantidade inesperada de embeddings.',
        provider,
      });
    }

    const indexedEmbeddings = response.data.map((item, responseIndex) => {
      const index =
        typeof item.index === 'number' && Number.isInteger(item.index)
          ? item.index
          : responseIndex;

      return {
        index,
        embedding: item.embedding,
      };
    });
    indexedEmbeddings.sort((left, right) => left.index - right.index);

    return indexedEmbeddings.map((item, expectedIndex) => {
      if (
        item.index !== expectedIndex ||
        !Array.isArray(item.embedding) ||
        item.embedding.length !== GEMINI_EMBEDDING_DIMENSION ||
        !item.embedding.every(
          (value) => typeof value === 'number' && Number.isFinite(value)
        )
      ) {
        throw new AiProviderError({
          code: 'invalid_response',
          message: `O embedding ${expectedIndex + 1} deve conter exatamente ${GEMINI_EMBEDDING_DIMENSION} números finitos.`,
          provider,
        });
      }

      return item.embedding;
    });
  }

  private async requestJson<ResponseBody>(
    request: ProviderRequest
  ): Promise<ResponseBody> {
    let lastError: AiProviderError | null = null;

    for (let attempt = 1; attempt <= this.maxAttempts; attempt += 1) {
      try {
        const response = await this.fetchWithTimeout(request.url, request.init);

        if (!response.ok) {
          throw await createHttpError(request.provider, response);
        }

        let payload: unknown;

        try {
          payload = await response.json();
        } catch {
          throw new AiProviderError({
            code: 'invalid_response',
            message: 'O provedor de IA retornou uma resposta JSON inválida.',
            provider: request.provider,
          });
        }

        return payload as ResponseBody;
      } catch (error) {
        lastError = normalizeRequestError(request.provider, error);

        if (!lastError.retryable || attempt >= this.maxAttempts) {
          throw lastError;
        }

        const exponentialDelay = this.retryBaseDelayMs * 2 ** (attempt - 1);
        const requestedDelay = lastError.retryAfterMs ?? 0;
        const delay = Math.min(
          this.maxRetryDelayMs,
          Math.max(exponentialDelay, requestedDelay)
        );

        await this.sleep(delay);
      }
    }

    throw (
      lastError ??
      new AiProviderError({
        code: 'network_error',
        message: 'Não foi possível comunicar com o provedor de IA.',
        provider: request.provider,
      })
    );
  }

  private async fetchWithTimeout(
    url: string,
    init: RequestInit
  ): Promise<Response> {
    if (this.isProduction) {
      return this.fetchSafely(url, init);
    }

    const abortController = new AbortController();
    let timeoutHandle: ReturnType<typeof setTimeout> | null = null;
    const timeoutPromise = new Promise<never>((_resolve, reject) => {
      timeoutHandle = setTimeout(() => {
        abortController.abort();
        reject(new AiProviderRequestTimeoutError());
      }, this.timeoutMs);
    });

    try {
      return await Promise.race([
        this.fetchImpl(url, {
          ...init,
          signal: abortController.signal,
        }),
        timeoutPromise,
      ]);
    } finally {
      if (timeoutHandle) {
        clearTimeout(timeoutHandle);
      }
    }
  }

  private async fetchSafely(url: string, init: RequestInit): Promise<Response> {
    const method = init.method?.toUpperCase();

    if (method !== 'POST') {
      throw createConfigurationError(
        null,
        'O cliente de IA permite somente requisições POST.'
      );
    }

    const requestHeaders = new Headers(init.headers);
    const headers: Record<string, string> = {};
    requestHeaders.forEach((value, name) => {
      headers[name] = value;
    });

    if (init.body !== undefined && typeof init.body !== 'string') {
      throw createConfigurationError(
        null,
        'O corpo da requisição ao provedor de IA deve ser JSON.'
      );
    }

    const result = await this.safeOutboundHttpImpl({
      url,
      method: 'POST',
      headers,
      body: init.body,
      isProduction: true,
      allowLocalhostHttp: this.allowLocalhostHttp,
      timeoutMs: this.timeoutMs,
      sensitiveHeaderNames: ['authorization', 'x-goog-api-key'],
    });

    if (result.kind === 'failure') {
      if (result.isTimeout) {
        throw new AiProviderRequestTimeoutError();
      }

      if (SAFE_OUTBOUND_POLICY_FAILURE_CODES.has(result.code)) {
        throw new AiProviderOutboundPolicyError();
      }

      throw new AiProviderNetworkRequestError(result.retryable);
    }

    const responseHeaders = new Headers();

    for (const [name, value] of Object.entries(result.headers)) {
      for (const item of Array.isArray(value) ? value : [value]) {
        responseHeaders.append(name, item);
      }
    }

    return new Response(new Uint8Array(result.body), {
      status: result.statusCode,
      headers: responseHeaders,
    });
  }
}

export const aiProviderClient = new AiProviderClient();

/**
 * Convenience function for create/activate flows. It performs a real minimal
 * chat call and throws `AiProviderError` when the configuration is unusable.
 */
export const validateAiProviderConfiguration = async (
  input: ValidateAiProviderConfigurationInput
): Promise<AiProviderValidationResult> =>
  (input.client ?? aiProviderClient).validateConfiguration(input.configuration);
