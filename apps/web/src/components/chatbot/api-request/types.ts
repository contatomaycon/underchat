export const API_REQUEST_METHODS = [
  'GET',
  'HEAD',
  'OPTIONS',
  'POST',
  'PUT',
  'PATCH',
  'DELETE',
] as const;

export const API_REQUEST_BODY_TYPES = [
  'none',
  'json',
  'raw',
  'formUrlEncoded',
  'multipart',
] as const;

export const API_REQUEST_AUTH_TYPES = [
  'none',
  'bearer',
  'apiKey',
  'basic',
] as const;

export type ApiRequestMethod = (typeof API_REQUEST_METHODS)[number];
export type ApiRequestBodyType = (typeof API_REQUEST_BODY_TYPES)[number];
export type ApiRequestAuthType = (typeof API_REQUEST_AUTH_TYPES)[number];
export type ApiRequestValueType =
  | 'string'
  | 'number'
  | 'boolean'
  | 'object'
  | 'array'
  | 'null'
  | 'binary'
  | 'unknown';

export interface ApiRequestProtectedValue {
  id: string;
  value: string;
  hasValue?: boolean;
}

export interface ApiRequestKeyValue {
  id: string;
  enabled: boolean;
  key: string;
  value: string;
  sensitive: boolean;
  hasValue?: boolean;
}

export interface ApiRequestMultipartPart {
  id: string;
  enabled: boolean;
  name: string;
  type: 'text' | 'file';
  value: string;
  fileName: string;
  contentType: string;
  sensitive: boolean;
  hasValue?: boolean;
}

export interface ApiRequestAuthConfig {
  type: ApiRequestAuthType;
  bearer: {
    token: ApiRequestProtectedValue;
  };
  apiKey: {
    placement: 'header' | 'query';
    name: string;
    value: ApiRequestProtectedValue;
  };
  basic: {
    username: ApiRequestProtectedValue;
    password: ApiRequestProtectedValue;
  };
}

export interface ApiRequestBodyConfig {
  id: string;
  type: ApiRequestBodyType;
  json: string;
  raw: string;
  contentType: string;
  sensitive: boolean;
  hasValue?: boolean;
  formFields: ApiRequestKeyValue[];
  multipart: ApiRequestMultipartPart[];
}

export interface ApiRequestExecutionConfig {
  mode: 'once' | 'forEach';
  itemsExpression: string;
  concurrency: 1 | 2 | 3;
  failurePolicy: 'failFast' | 'collectErrors';
  timeoutMs: number;
  retry: {
    maxAttempts: 1 | 2 | 3;
    initialDelayMs: number;
  };
  idempotencyKey: string;
}

export interface ApiResponseContractField {
  path: string;
  type: ApiRequestValueType;
  nullable?: boolean;
  projectedFromArray?: boolean;
}

export interface ApiRequestTestEvidence {
  proof: string;
  fingerprint: string;
  testedAt: string;
  statusCode: number;
  durationMs?: number;
  bodyType: string;
}

export interface ApiRequestCaptureConfig {
  mode: 'full' | 'fields';
  paths: string[];
  responseHeaders: string[];
  contract: ApiResponseContractField[];
  availableResponseHeaders: string[];
}

export interface ApiRequestTestConfig {
  state: 'untested' | 'tested' | 'changed';
  evidence: ApiRequestTestEvidence | null;
}

export interface ApiRequestConfig {
  version: 1;
  outputKey: string;
  method: ApiRequestMethod;
  url: string;
  queryParams: ApiRequestKeyValue[];
  headers: ApiRequestKeyValue[];
  auth: ApiRequestAuthConfig;
  body: ApiRequestBodyConfig;
  execution: ApiRequestExecutionConfig;
  capture: ApiRequestCaptureConfig;
  test: ApiRequestTestConfig;
}

export interface ApiRequestVariable {
  tag: string;
  label?: string;
  description?: string;
  type?: ApiRequestValueType;
  sourceNodeId?: string;
}

export interface ApiRequestTestInput {
  nodeId: string;
  config: ApiRequestConfig;
  sampleVariables: Record<string, string>;
  upstreamContracts?: Record<string, unknown>;
  confirmSideEffects: boolean;
}

export interface ApiRequestTestResult {
  ok: boolean;
  statusCode: number;
  durationMs: number;
  headers: Record<string, string>;
  bodyType: string;
  preview: unknown;
  contract: ApiResponseContractField[];
  evidence: ApiRequestTestEvidence;
}

export type ApiRequestTestCallback = (
  input: ApiRequestTestInput
) => Promise<ApiRequestTestResult>;

export interface ApiRequestNodeData extends Record<string, unknown> {
  apiRequest?: Partial<ApiRequestConfig>;
  availableVariables?: ApiRequestVariable[];
  upstreamContracts?: Record<string, unknown>;
  readOnly?: boolean;
  onUpdate?: (config: ApiRequestConfig) => void | Promise<void>;
  onTest?: ApiRequestTestCallback;
  onRemove?: () => void;
}

export type ApiRequestIdFactory = () => string;

const FALLBACK_OUTPUT_KEY = 'api_1';
const FORBIDDEN_PATH_SEGMENTS = new Set([
  '__proto__',
  'constructor',
  'prototype',
]);

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const asRecord = (value: unknown): Record<string, unknown> =>
  isRecord(value) ? value : {};

const asString = (value: unknown, fallback = ''): string =>
  typeof value === 'string' ? value : fallback;

const asBoolean = (value: unknown, fallback = false): boolean =>
  typeof value === 'boolean' ? value : fallback;

const asNumber = (value: unknown, fallback: number): number =>
  typeof value === 'number' && Number.isFinite(value) ? value : fallback;

const clamp = (value: number, minimum: number, maximum: number): number =>
  Math.min(maximum, Math.max(minimum, value));

const isOneOf = <T extends readonly string[]>(
  value: unknown,
  choices: T
): value is T[number] =>
  typeof value === 'string' && choices.includes(value as T[number]);

export const createApiRequestId: ApiRequestIdFactory = () => {
  if (typeof globalThis.crypto?.randomUUID === 'function') {
    return globalThis.crypto.randomUUID();
  }

  return `api-field-${Date.now().toString(36)}-${Math.random()
    .toString(36)
    .slice(2)}`;
};

export const normalizeApiOutputKey = (
  value: unknown,
  fallback = FALLBACK_OUTPUT_KEY
): string => {
  if (typeof value !== 'string') return fallback;
  const normalized = value
    .trim()
    .toLowerCase()
    .replaceAll(/[^a-z0-9_]/g, '_');
  return /^api_[1-9]\d*$/.test(normalized) ? normalized : fallback;
};

export const getNextApiOutputKey = (
  existingKeys: readonly string[]
): string => {
  const usedIndexes = new Set(
    existingKeys.flatMap((key) => {
      const match = /^api_([1-9]\d*)$/.exec(key.trim().toLowerCase());
      return match ? [Number(match[1])] : [];
    })
  );
  let candidate = 1;
  while (usedIndexes.has(candidate)) candidate += 1;

  return `api_${candidate}`;
};

const createProtectedValue = (
  idFactory: ApiRequestIdFactory
): ApiRequestProtectedValue => ({
  id: idFactory(),
  value: '',
  hasValue: false,
});

export const createApiRequestKeyValue = (
  idFactory: ApiRequestIdFactory = createApiRequestId
): ApiRequestKeyValue => ({
  id: idFactory(),
  enabled: true,
  key: '',
  value: '',
  sensitive: false,
  hasValue: false,
});

export const createApiRequestMultipartPart = (
  idFactory: ApiRequestIdFactory = createApiRequestId
): ApiRequestMultipartPart => ({
  id: idFactory(),
  enabled: true,
  name: '',
  type: 'text',
  value: '',
  fileName: '',
  contentType: '',
  sensitive: false,
  hasValue: false,
});

export const createDefaultApiRequestConfig = (
  outputKey = FALLBACK_OUTPUT_KEY,
  idFactory: ApiRequestIdFactory = createApiRequestId
): ApiRequestConfig => ({
  version: 1,
  outputKey: normalizeApiOutputKey(outputKey),
  method: 'GET',
  url: '',
  queryParams: [],
  headers: [],
  auth: {
    type: 'none',
    bearer: { token: createProtectedValue(idFactory) },
    apiKey: {
      placement: 'header',
      name: 'X-API-Key',
      value: createProtectedValue(idFactory),
    },
    basic: {
      username: createProtectedValue(idFactory),
      password: createProtectedValue(idFactory),
    },
  },
  body: {
    id: idFactory(),
    type: 'none',
    json: '',
    raw: '',
    contentType: 'text/plain',
    sensitive: false,
    hasValue: false,
    formFields: [],
    multipart: [],
  },
  execution: {
    mode: 'once',
    itemsExpression: '',
    concurrency: 1,
    failurePolicy: 'failFast',
    timeoutMs: 15_000,
    retry: {
      maxAttempts: 2,
      initialDelayMs: 500,
    },
    idempotencyKey: '',
  },
  capture: {
    mode: 'full',
    paths: [],
    responseHeaders: [],
    contract: [],
    availableResponseHeaders: [],
  },
  test: {
    state: 'untested',
    evidence: null,
  },
});

const normalizeProtectedValue = (
  value: unknown,
  fallback: ApiRequestProtectedValue,
  idFactory: ApiRequestIdFactory
): ApiRequestProtectedValue => {
  if (typeof value === 'string') {
    return {
      id: fallback.id || idFactory(),
      value,
      hasValue: Boolean(value),
    };
  }

  const record = asRecord(value);
  return {
    id: asString(record.id, fallback.id || idFactory()),
    value: asString(record.value),
    hasValue: asBoolean(record.hasValue, Boolean(record.value)),
  };
};

const normalizeKeyValue = (
  value: unknown,
  idFactory: ApiRequestIdFactory
): ApiRequestKeyValue => {
  const record = asRecord(value);
  return {
    id: asString(record.id, idFactory()),
    enabled: asBoolean(record.enabled, true),
    key: asString(record.key),
    value: asString(record.value),
    sensitive: asBoolean(record.sensitive),
    hasValue: asBoolean(record.hasValue, Boolean(record.value)),
  };
};

const normalizeKeyValues = (
  value: unknown,
  idFactory: ApiRequestIdFactory
): ApiRequestKeyValue[] =>
  Array.isArray(value)
    ? value.map((entry) => normalizeKeyValue(entry, idFactory))
    : [];

const normalizeMultipartPart = (
  value: unknown,
  idFactory: ApiRequestIdFactory
): ApiRequestMultipartPart => {
  const record = asRecord(value);
  return {
    id: asString(record.id, idFactory()),
    enabled: asBoolean(record.enabled, true),
    name: asString(record.name),
    type: record.type === 'file' ? 'file' : 'text',
    value: asString(record.value),
    fileName: asString(record.fileName),
    contentType: asString(record.contentType),
    sensitive: asBoolean(record.sensitive),
    hasValue: asBoolean(record.hasValue, Boolean(record.value)),
  };
};

export const isSafeApiResponsePath = (path: string): boolean => {
  const trimmed = path.trim();
  if (!trimmed || trimmed.length > 512) return false;
  const segments = trimmed.split('.').filter(Boolean);
  return (
    segments.length > 0 &&
    segments.every((segment) => !FORBIDDEN_PATH_SEGMENTS.has(segment))
  );
};

const normalizeContract = (value: unknown): ApiResponseContractField[] => {
  if (!Array.isArray(value)) return [];
  const allowedTypes: readonly ApiRequestValueType[] = [
    'string',
    'number',
    'boolean',
    'object',
    'array',
    'null',
    'binary',
    'unknown',
  ];

  return value.flatMap((entry) => {
    const record = asRecord(entry);
    const path = asString(record.path).trim();
    if (!isSafeApiResponsePath(path)) return [];
    const type = allowedTypes.includes(record.type as ApiRequestValueType)
      ? (record.type as ApiRequestValueType)
      : 'unknown';

    return [
      {
        path,
        type,
        nullable: asBoolean(record.nullable),
        projectedFromArray: asBoolean(record.projectedFromArray),
      },
    ];
  });
};

const normalizeEvidence = (value: unknown): ApiRequestTestEvidence | null => {
  const record = asRecord(value);
  const proof = asString(record.proof);
  const fingerprint = asString(record.fingerprint);
  const testedAt = asString(record.testedAt);
  if (!proof || !fingerprint || !testedAt) return null;

  return {
    proof,
    fingerprint,
    testedAt,
    statusCode: Math.trunc(asNumber(record.statusCode, 0)),
    durationMs: Math.max(0, asNumber(record.durationMs, 0)),
    bodyType: asString(record.bodyType, 'unknown'),
  };
};

export const normalizeApiRequestConfig = (
  input: unknown,
  options: {
    outputKey?: string;
    idFactory?: ApiRequestIdFactory;
  } = {}
): ApiRequestConfig => {
  const idFactory = options.idFactory ?? createApiRequestId;
  const defaults = createDefaultApiRequestConfig(
    options.outputKey ?? FALLBACK_OUTPUT_KEY,
    idFactory
  );
  const record = asRecord(input);
  const auth = asRecord(record.auth);
  const bearer = asRecord(auth.bearer);
  const apiKey = asRecord(auth.apiKey);
  const basic = asRecord(auth.basic);
  const body = asRecord(record.body);
  const execution = asRecord(record.execution);
  const retry = asRecord(execution.retry);
  const capture = asRecord(record.capture);
  const test = asRecord(record.test);
  const evidence = normalizeEvidence(test.evidence);

  const concurrency = clamp(
    Math.trunc(asNumber(execution.concurrency, 1)),
    1,
    3
  ) as 1 | 2 | 3;
  const maxAttempts = clamp(
    Math.trunc(asNumber(retry.maxAttempts, 2)),
    1,
    3
  ) as 1 | 2 | 3;

  return {
    version: 1,
    outputKey: normalizeApiOutputKey(
      record.outputKey,
      normalizeApiOutputKey(options.outputKey, defaults.outputKey)
    ),
    method: isOneOf(record.method, API_REQUEST_METHODS)
      ? record.method
      : defaults.method,
    url: asString(record.url),
    queryParams: normalizeKeyValues(record.queryParams, idFactory),
    headers: normalizeKeyValues(record.headers, idFactory),
    auth: {
      type: isOneOf(auth.type, API_REQUEST_AUTH_TYPES)
        ? auth.type
        : defaults.auth.type,
      bearer: {
        token: normalizeProtectedValue(
          bearer.token,
          defaults.auth.bearer.token,
          idFactory
        ),
      },
      apiKey: {
        placement: apiKey.placement === 'query' ? 'query' : 'header',
        name: asString(apiKey.name, defaults.auth.apiKey.name),
        value: normalizeProtectedValue(
          apiKey.value,
          defaults.auth.apiKey.value,
          idFactory
        ),
      },
      basic: {
        username: normalizeProtectedValue(
          basic.username,
          defaults.auth.basic.username,
          idFactory
        ),
        password: normalizeProtectedValue(
          basic.password,
          defaults.auth.basic.password,
          idFactory
        ),
      },
    },
    body: {
      id: asString(body.id, defaults.body.id),
      type: isOneOf(body.type, API_REQUEST_BODY_TYPES)
        ? body.type
        : defaults.body.type,
      json: asString(body.json),
      raw: asString(body.raw),
      contentType: asString(body.contentType, defaults.body.contentType),
      sensitive: asBoolean(body.sensitive),
      hasValue: asBoolean(
        body.hasValue,
        Boolean(asString(body.json) || asString(body.raw))
      ),
      formFields: normalizeKeyValues(body.formFields, idFactory),
      multipart: Array.isArray(body.multipart)
        ? body.multipart.map((part) => normalizeMultipartPart(part, idFactory))
        : [],
    },
    execution: {
      mode: execution.mode === 'forEach' ? 'forEach' : 'once',
      itemsExpression: asString(execution.itemsExpression),
      concurrency,
      failurePolicy:
        execution.failurePolicy === 'collectErrors'
          ? 'collectErrors'
          : 'failFast',
      timeoutMs: clamp(
        Math.trunc(asNumber(execution.timeoutMs, defaults.execution.timeoutMs)),
        1_000,
        60_000
      ),
      retry: {
        maxAttempts,
        initialDelayMs: clamp(
          Math.trunc(
            asNumber(
              retry.initialDelayMs,
              defaults.execution.retry.initialDelayMs
            )
          ),
          100,
          5_000
        ),
      },
      idempotencyKey: asString(execution.idempotencyKey),
    },
    capture: {
      mode: capture.mode === 'fields' ? 'fields' : 'full',
      paths: Array.isArray(capture.paths)
        ? [
            ...new Set(
              capture.paths.filter(
                (path): path is string =>
                  typeof path === 'string' && isSafeApiResponsePath(path)
              )
            ),
          ]
        : [],
      responseHeaders: Array.isArray(capture.responseHeaders)
        ? [
            ...new Set(
              capture.responseHeaders
                .filter(
                  (header): header is string =>
                    typeof header === 'string' && Boolean(header.trim())
                )
                .map((header) => header.trim().toLowerCase())
            ),
          ]
        : [],
      contract: normalizeContract(capture.contract),
      availableResponseHeaders: Array.isArray(capture.availableResponseHeaders)
        ? [
            ...new Set(
              capture.availableResponseHeaders
                .filter(
                  (header): header is string => typeof header === 'string'
                )
                .map((header) => header.trim().toLowerCase())
                .filter(Boolean)
            ),
          ]
        : [],
    },
    test: {
      state:
        test.state === 'changed' ? 'changed' : evidence ? 'tested' : 'untested',
      evidence,
    },
  };
};

export const cloneApiRequestConfig = (
  config: ApiRequestConfig
): ApiRequestConfig => normalizeApiRequestConfig(config);

export const markApiRequestChanged = (
  config: ApiRequestConfig
): ApiRequestConfig => ({
  ...config,
  test: {
    state: config.test.state === 'untested' ? 'untested' : 'changed',
    evidence: null,
  },
});

export const formatApiVariableTag = (
  outputKey: string,
  path?: string
): string => {
  const normalizedKey = normalizeApiOutputKey(outputKey);
  const normalizedPath = path
    ?.trim()
    .replaceAll('[]', '')
    .replace(/^\.+|\.+$/g, '');
  return `{{ ${normalizedKey}${normalizedPath ? `.${normalizedPath}` : ''} }}`;
};

export const getApiRequestHost = (url: string): string => {
  const trimmed = url.trim();
  if (!trimmed) return 'Endpoint não definido';

  try {
    const templateSafeUrl = trimmed.replaceAll(/\{\{[^{}]+\}\}/g, 'value');
    return new URL(templateSafeUrl).host || 'Endpoint inválido';
  } catch {
    return 'Endpoint inválido';
  }
};

const stableSerialize = (value: unknown): string => {
  if (Array.isArray(value)) {
    return `[${value.map(stableSerialize).join(',')}]`;
  }
  if (isRecord(value)) {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableSerialize(value[key])}`)
      .join(',')}}`;
  }
  return JSON.stringify(value) ?? 'null';
};

export const getApiRequestTestSnapshot = (config: ApiRequestConfig): string =>
  stableSerialize({
    method: config.method,
    url: config.url,
    queryParams: config.queryParams,
    headers: config.headers,
    auth: config.auth,
    body: config.body,
    execution: config.execution,
  });

export const isSideEffectMethod = (method: ApiRequestMethod): boolean =>
  ['POST', 'PUT', 'PATCH', 'DELETE'].includes(method);

export const applyApiRequestTestResult = (
  config: ApiRequestConfig,
  result: ApiRequestTestResult
): ApiRequestConfig => ({
  ...config,
  capture: {
    ...config.capture,
    contract: normalizeContract(result.contract),
    availableResponseHeaders: [
      ...new Set(
        Object.keys(result.headers)
          .map((header) => header.trim().toLowerCase())
          .filter(Boolean)
      ),
    ],
  },
  test: {
    state: 'tested',
    evidence: { ...result.evidence },
  },
});
