import { lookup as dnsLookup } from 'node:dns/promises';
import { request as requestHttp, type OutgoingHttpHeaders } from 'node:http';
import { request as requestHttps } from 'node:https';
import { isIP, type LookupFunction } from 'node:net';

import {
  isBlockedOutboundWebhookAddress,
  isLoopbackOutboundWebhookAddress,
  validateOutboundWebhookUrl,
  type OutboundWebhookDnsResolver,
  type OutboundWebhookLookupAddress,
} from './outboundWebhookHttp';

export const SAFE_OUTBOUND_HTTP_MAX_REQUEST_BYTES = 16 * 1024 * 1024;
export const SAFE_OUTBOUND_HTTP_MAX_RESPONSE_BYTES = 16 * 1024 * 1024;
export const SAFE_OUTBOUND_HTTP_DEFAULT_TIMEOUT_MS = 10_000;
export const SAFE_OUTBOUND_HTTP_MAX_TIMEOUT_MS = 60_000;
export const SAFE_OUTBOUND_HTTP_MAX_REDIRECTS = 3;

export const SAFE_OUTBOUND_HTTP_METHODS = [
  'GET',
  'HEAD',
  'OPTIONS',
  'POST',
  'PUT',
  'PATCH',
  'DELETE',
] as const;

export type SafeOutboundHttpMethod =
  (typeof SAFE_OUTBOUND_HTTP_METHODS)[number];

export type SafeOutboundHttpRequestHeaders = Readonly<
  Record<string, string | readonly string[]>
>;

export type SafeOutboundHttpResponseHeaders = Record<string, string | string[]>;

export type SafeOutboundHttpLookupAddress = OutboundWebhookLookupAddress;
export type SafeOutboundHttpDnsResolver = OutboundWebhookDnsResolver;

export type SafeOutboundHttpFailureCode =
  | 'invalid_method'
  | 'invalid_url'
  | 'url_credentials_forbidden'
  | 'url_fragment_forbidden'
  | 'http_forbidden'
  | 'protocol_forbidden'
  | 'port_forbidden'
  | 'invalid_header_name'
  | 'invalid_header_value'
  | 'duplicate_header'
  | 'forbidden_header'
  | 'headers_too_large'
  | 'invalid_body'
  | 'payload_too_large'
  | 'dns_empty'
  | 'dns_invalid_address'
  | 'dns_non_loopback_address'
  | 'dns_blocked_address'
  | 'dns_error'
  | 'invalid_redirect'
  | 'too_many_redirects'
  | 'response_too_large'
  | 'response_aborted'
  | 'response_error'
  | 'invalid_http_status'
  | 'unsupported_upgrade'
  | 'timeout'
  | 'network_error'
  | 'internal_error';

export interface ExecuteSafeOutboundHttpInput {
  readonly url: string;
  readonly method: SafeOutboundHttpMethod;
  readonly headers?: SafeOutboundHttpRequestHeaders;
  readonly body?: Buffer | Uint8Array | string;
  readonly isProduction: boolean;
  readonly allowLocalhostHttp: boolean;
  readonly timeoutMs?: number;
  readonly responseLimitBytes?: number;
  readonly maxRedirects?: number;
  readonly dnsResolver?: SafeOutboundHttpDnsResolver;
  /**
   * Extra credential-bearing header names to remove if a redirect changes
   * origin. Common authentication, token, secret and cookie names are inferred.
   */
  readonly sensitiveHeaderNames?: readonly string[];
}

export interface SafeOutboundHttpResponse {
  readonly kind: 'response';
  readonly statusCode: number;
  readonly headers: SafeOutboundHttpResponseHeaders;
  readonly body: Buffer;
  readonly finalUrl: string;
  readonly redirectCount: number;
  readonly durationMs: number;
}

export interface SafeOutboundHttpFailure {
  readonly kind: 'failure';
  readonly code: SafeOutboundHttpFailureCode;
  readonly message: string;
  readonly retryable: boolean;
  readonly isTimeout: boolean;
  readonly durationMs: number;
}

export type SafeOutboundHttpResult =
  SafeOutboundHttpResponse | SafeOutboundHttpFailure;

interface ValidatedRequestHeaders {
  readonly headers: Record<string, string | readonly string[]>;
  readonly sensitiveHeaderNames: ReadonlySet<string>;
}

interface SingleRequestResponse {
  readonly kind: 'response';
  readonly statusCode: number;
  readonly headers: SafeOutboundHttpResponseHeaders;
  readonly body: Buffer;
}

interface InternalFailure {
  readonly kind: 'failure';
  readonly code: SafeOutboundHttpFailureCode;
  readonly message: string;
  readonly retryable: boolean;
  readonly isTimeout: boolean;
}

type SingleRequestResult = SingleRequestResponse | InternalFailure;

interface AddressResolution {
  readonly address: string;
  readonly family: 4 | 6;
}

const HEADER_NAME_PATTERN = /^[!#$%&'*+.^_`|~\dA-Za-z-]+$/u;
const MAX_HEADER_COUNT = 100;
const MAX_REQUEST_HEADER_BYTES = 64 * 1024;

const FORBIDDEN_HEADER_NAMES = new Set([
  'connection',
  'content-length',
  'forwarded',
  'host',
  'keep-alive',
  'proxy-authenticate',
  'proxy-authorization',
  'te',
  'trailer',
  'transfer-encoding',
  'upgrade',
]);

const BODY_HEADER_NAMES = new Set([
  'content-encoding',
  'content-language',
  'content-location',
  'content-type',
]);

const DEFAULT_SENSITIVE_HEADER_PATTERN =
  /(?:^|[-_])(?:auth(?:orization)?|cookie|credential|secret|token|api[-_]?key)(?:$|[-_])/iu;

const REDIRECT_STATUS_CODES = new Set([301, 302, 303, 307, 308]);

const POLICY_FAILURE_MESSAGES: Readonly<
  Record<
    | 'invalid_url'
    | 'url_credentials_forbidden'
    | 'url_fragment_forbidden'
    | 'http_forbidden'
    | 'protocol_forbidden'
    | 'port_forbidden',
    string
  >
> = {
  invalid_url: 'Outbound HTTP URL is invalid',
  url_credentials_forbidden: 'Credentials in the URL are forbidden',
  url_fragment_forbidden: 'URL fragments are forbidden',
  http_forbidden: 'HTTP is allowed only for localhost development endpoints',
  protocol_forbidden: 'Outbound HTTP URL must use HTTPS',
  port_forbidden: 'Production outbound HTTP requests must use port 443',
};

const normalizeHostname = (hostname: string): string =>
  hostname
    .replace(/^\[|\]$/gu, '')
    .replace(/%.*$/u, '')
    .toLowerCase();

const normalizeBoundedInteger = (input: {
  value: number | undefined;
  fallback: number;
  minimum: number;
  maximum: number;
}): number => {
  const finiteValue = Number.isFinite(input.value)
    ? Math.floor(input.value as number)
    : input.fallback;
  return Math.max(input.minimum, Math.min(finiteValue, input.maximum));
};

const defaultDnsResolver: OutboundWebhookDnsResolver = async (hostname) => {
  const literalFamily = isIP(hostname);
  if (literalFamily === 4 || literalFamily === 6) {
    return [{ address: hostname, family: literalFamily }];
  }

  const addresses = await dnsLookup(hostname, {
    all: true,
    verbatim: true,
  });
  return addresses.map((item) => ({
    address: item.address,
    family: item.family === 6 ? (6 as const) : (4 as const),
  }));
};

const failure = (
  code: SafeOutboundHttpFailureCode,
  message: string,
  options: { retryable?: boolean; isTimeout?: boolean } = {}
): InternalFailure => ({
  kind: 'failure',
  code,
  message,
  retryable: options.retryable ?? false,
  isTimeout: options.isTimeout ?? false,
});

const withDuration = (
  result: InternalFailure,
  startedAt: number
): SafeOutboundHttpFailure => ({
  ...result,
  durationMs: Math.max(0, Date.now() - startedAt),
});

const isForbiddenHeaderName = (name: string): boolean =>
  FORBIDDEN_HEADER_NAMES.has(name) ||
  name.startsWith('proxy-') ||
  name.startsWith('x-underchat-');

const isValidHeaderValue = (value: string): boolean =>
  !/[\r\n\u0000]/u.test(value);

const validateRequestHeaders = (
  input: SafeOutboundHttpRequestHeaders | undefined,
  extraSensitiveNames: readonly string[] | undefined
): ValidatedRequestHeaders | InternalFailure => {
  if (input === undefined) {
    return {
      headers: {},
      sensitiveHeaderNames: new Set(
        (extraSensitiveNames ?? []).map((name) => name.trim().toLowerCase())
      ),
    };
  }

  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    return failure('invalid_header_name', 'Request headers are invalid');
  }

  const entries = Object.entries(input);
  if (entries.length > MAX_HEADER_COUNT) {
    return failure(
      'headers_too_large',
      'Outbound HTTP request contains too many headers'
    );
  }

  const headers: Record<string, string | readonly string[]> = Object.create(
    null
  ) as Record<string, string | readonly string[]>;
  const sensitiveHeaderNames = new Set(
    (extraSensitiveNames ?? []).map((name) => name.trim().toLowerCase())
  );
  let byteLength = 0;

  for (const [rawName, rawValue] of entries) {
    const name = rawName.trim().toLowerCase();
    if (!name || !HEADER_NAME_PATTERN.test(name)) {
      return failure('invalid_header_name', 'Request header name is invalid');
    }
    if (Object.hasOwn(headers, name)) {
      return failure(
        'duplicate_header',
        'Request contains duplicate header names'
      );
    }
    if (isForbiddenHeaderName(name)) {
      return failure(
        'forbidden_header',
        'Request contains a security-sensitive forbidden header'
      );
    }

    const values = Array.isArray(rawValue) ? rawValue : [rawValue];
    if (
      !values.length ||
      values.some(
        (value) => typeof value !== 'string' || !isValidHeaderValue(value)
      )
    ) {
      return failure('invalid_header_value', 'Request header value is invalid');
    }

    byteLength += Buffer.byteLength(name, 'utf8');
    for (const value of values) {
      byteLength += Buffer.byteLength(value, 'utf8');
    }
    if (byteLength > MAX_REQUEST_HEADER_BYTES) {
      return failure(
        'headers_too_large',
        'Outbound HTTP request headers exceed 64 KiB'
      );
    }

    headers[name] = Array.isArray(rawValue) ? [...values] : (values[0] ?? '');
    if (DEFAULT_SENSITIVE_HEADER_PATTERN.test(name)) {
      sensitiveHeaderNames.add(name);
    }
  }

  return { headers, sensitiveHeaderNames };
};

const normalizeBody = (
  body: ExecuteSafeOutboundHttpInput['body']
): Buffer | undefined | InternalFailure => {
  if (body === undefined) {
    return undefined;
  }

  let normalized: Buffer;
  if (typeof body === 'string') {
    normalized = Buffer.from(body, 'utf8');
  } else if (Buffer.isBuffer(body)) {
    normalized = body;
  } else if (body instanceof Uint8Array) {
    normalized = Buffer.from(body);
  } else {
    return failure('invalid_body', 'Outbound HTTP request body is invalid');
  }

  if (normalized.byteLength > SAFE_OUTBOUND_HTTP_MAX_REQUEST_BYTES) {
    return failure(
      'payload_too_large',
      'Outbound HTTP request body exceeds 16 MiB'
    );
  }
  return normalized;
};

const validateMethod = (
  method: ExecuteSafeOutboundHttpInput['method']
): SafeOutboundHttpMethod | InternalFailure => {
  if (typeof method !== 'string') {
    return failure('invalid_method', 'Outbound HTTP method is invalid');
  }
  const normalized = method.toUpperCase();
  if (!(SAFE_OUTBOUND_HTTP_METHODS as readonly string[]).includes(normalized)) {
    return failure('invalid_method', 'Outbound HTTP method is not supported');
  }
  return normalized as SafeOutboundHttpMethod;
};

const resolvePinnedAddress = async (input: {
  hostname: string;
  allowsLoopback: boolean;
  resolver: OutboundWebhookDnsResolver;
}): Promise<AddressResolution | InternalFailure> => {
  let addresses: readonly OutboundWebhookLookupAddress[];
  try {
    addresses = await input.resolver(normalizeHostname(input.hostname));
  } catch {
    return failure('dns_error', 'Outbound HTTP DNS lookup failed', {
      retryable: true,
    });
  }

  if (!addresses.length) {
    return failure(
      'dns_empty',
      'Outbound HTTP hostname resolved to no addresses'
    );
  }

  for (const address of addresses) {
    if (isIP(normalizeHostname(address.address)) !== address.family) {
      return failure(
        'dns_invalid_address',
        'Outbound HTTP hostname resolved to an invalid address'
      );
    }

    if (input.allowsLoopback) {
      if (!isLoopbackOutboundWebhookAddress(address.address)) {
        return failure(
          'dns_non_loopback_address',
          'Local development endpoint resolved outside loopback'
        );
      }
    } else if (isBlockedOutboundWebhookAddress(address.address)) {
      return failure(
        'dns_blocked_address',
        'Outbound HTTP hostname resolved to a blocked address'
      );
    }
  }

  const pinned = addresses[0];
  if (!pinned) {
    return failure(
      'dns_empty',
      'Outbound HTTP hostname resolved to no addresses'
    );
  }
  return { address: pinned.address, family: pinned.family };
};

const remainingTime = (startedAt: number, timeoutMs: number): number =>
  timeoutMs - (Date.now() - startedAt);

const resolveWithTimeout = async (input: {
  hostname: string;
  allowsLoopback: boolean;
  resolver: OutboundWebhookDnsResolver;
  timeoutMs: number;
}): Promise<AddressResolution | InternalFailure> => {
  if (input.timeoutMs <= 0) {
    return failure('timeout', 'Outbound HTTP request timed out', {
      retryable: true,
      isTimeout: true,
    });
  }

  let timeout: NodeJS.Timeout | undefined;
  try {
    const timeoutResult = new Promise<InternalFailure>((resolve) => {
      timeout = setTimeout(
        () =>
          resolve(
            failure('timeout', 'Outbound HTTP request timed out', {
              retryable: true,
              isTimeout: true,
            })
          ),
        input.timeoutMs
      );
    });
    return await Promise.race([resolvePinnedAddress(input), timeoutResult]);
  } finally {
    if (timeout) {
      clearTimeout(timeout);
    }
  }
};

const responseHeadersToRecord = (
  headers: Readonly<Record<string, string | string[] | undefined>>
): SafeOutboundHttpResponseHeaders => {
  const output: SafeOutboundHttpResponseHeaders = Object.create(
    null
  ) as SafeOutboundHttpResponseHeaders;
  for (const [name, value] of Object.entries(headers)) {
    if (value !== undefined) {
      output[name.toLowerCase()] = Array.isArray(value) ? [...value] : value;
    }
  }
  return output;
};

const requestOnce = (input: {
  url: URL;
  method: SafeOutboundHttpMethod;
  headers: Readonly<Record<string, string | readonly string[]>>;
  body: Buffer | undefined;
  pinned: AddressResolution;
  timeoutMs: number;
  responseLimitBytes: number;
}): Promise<SingleRequestResult> => {
  if (input.timeoutMs <= 0) {
    return Promise.resolve(
      failure('timeout', 'Outbound HTTP request timed out', {
        retryable: true,
        isTimeout: true,
      })
    );
  }

  const pinnedLookup: LookupFunction = (_hostname, options, callback) => {
    if (options.all) {
      callback(null, [input.pinned]);
      return;
    }
    callback(null, input.pinned.address, input.pinned.family);
  };
  const request = input.url.protocol === 'https:' ? requestHttps : requestHttp;

  return new Promise<SingleRequestResult>((resolve) => {
    let hasSettled = false;
    let timeout: NodeJS.Timeout | undefined;

    const finish = (result: SingleRequestResult): void => {
      if (hasSettled) {
        return;
      }
      hasSettled = true;
      if (timeout) {
        clearTimeout(timeout);
      }
      resolve(result);
    };

    const headers: OutgoingHttpHeaders = {};
    for (const [name, value] of Object.entries(input.headers)) {
      headers[name] = typeof value === 'string' ? value : [...value];
    }
    if (input.body !== undefined) {
      headers['content-length'] = String(input.body.byteLength);
    }

    const clientRequest = request(
      input.url,
      {
        method: input.method,
        agent: false,
        lookup: pinnedLookup,
        headers,
      },
      (response) => {
        const chunks: Buffer[] = [];
        let receivedBytes = 0;

        response.on('data', (chunk: Buffer | string) => {
          if (hasSettled) {
            return;
          }

          const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
          receivedBytes += buffer.byteLength;
          if (receivedBytes > input.responseLimitBytes) {
            finish(
              failure(
                'response_too_large',
                'Outbound HTTP response exceeds the configured byte limit'
              )
            );
            response.destroy();
            clientRequest.destroy();
            return;
          }
          chunks.push(buffer);
        });

        response.once('aborted', () => {
          finish(
            failure('response_aborted', 'Outbound HTTP response was aborted', {
              retryable: true,
            })
          );
        });

        response.once('error', () => {
          finish(
            failure('response_error', 'Outbound HTTP response failed', {
              retryable: true,
            })
          );
        });

        response.once('end', () => {
          const statusCode = response.statusCode ?? 0;
          if (statusCode < 100 || statusCode > 599) {
            finish(
              failure(
                'invalid_http_status',
                'Outbound HTTP response status is invalid',
                { retryable: true }
              )
            );
            return;
          }

          finish({
            kind: 'response',
            statusCode,
            headers: responseHeadersToRecord(response.headers),
            body: Buffer.concat(chunks, receivedBytes),
          });
        });
      }
    );

    timeout = setTimeout(() => {
      finish(
        failure('timeout', 'Outbound HTTP request timed out', {
          retryable: true,
          isTimeout: true,
        })
      );
      clientRequest.destroy();
    }, input.timeoutMs);
    timeout.unref();

    clientRequest.once('upgrade', (_response, socket) => {
      socket.destroy();
      finish(
        failure(
          'unsupported_upgrade',
          'Outbound HTTP protocol upgrades are not supported'
        )
      );
    });

    clientRequest.once('error', () => {
      finish(
        failure('network_error', 'Outbound HTTP request failed', {
          retryable: true,
        })
      );
    });

    clientRequest.end(input.body);
  });
};

const stripSensitiveHeaders = (
  headers: Readonly<Record<string, string | readonly string[]>>,
  sensitiveHeaderNames: ReadonlySet<string>
): Record<string, string | readonly string[]> => {
  const output: Record<string, string | readonly string[]> = Object.create(
    null
  ) as Record<string, string | readonly string[]>;
  for (const [name, value] of Object.entries(headers)) {
    if (
      !sensitiveHeaderNames.has(name) &&
      !DEFAULT_SENSITIVE_HEADER_PATTERN.test(name)
    ) {
      output[name] = value;
    }
  }
  return output;
};

const stripBodyHeaders = (
  headers: Readonly<Record<string, string | readonly string[]>>
): Record<string, string | readonly string[]> => {
  const output: Record<string, string | readonly string[]> = Object.create(
    null
  ) as Record<string, string | readonly string[]>;
  for (const [name, value] of Object.entries(headers)) {
    if (!BODY_HEADER_NAMES.has(name)) {
      output[name] = value;
    }
  }
  return output;
};

const redirectMethod = (input: {
  statusCode: number;
  method: SafeOutboundHttpMethod;
}): SafeOutboundHttpMethod => {
  if (
    input.statusCode === 303 &&
    input.method !== 'GET' &&
    input.method !== 'HEAD'
  ) {
    return 'GET';
  }
  if (
    (input.statusCode === 301 || input.statusCode === 302) &&
    input.method === 'POST'
  ) {
    return 'GET';
  }
  return input.method;
};

const getHeader = (
  headers: SafeOutboundHttpResponseHeaders,
  name: string
): string | undefined => {
  const value = headers[name.toLowerCase()];
  return Array.isArray(value) ? value[0] : value;
};

const validateUrl = (input: {
  url: string;
  isProduction: boolean;
  allowLocalhostHttp: boolean;
}): { url: URL; allowsLoopback: boolean } | InternalFailure => {
  try {
    return validateOutboundWebhookUrl(input);
  } catch (error: unknown) {
    const rawCode =
      error && typeof error === 'object' && 'code' in error
        ? String(error.code)
        : 'invalid_url';
    const code = Object.hasOwn(POLICY_FAILURE_MESSAGES, rawCode)
      ? (rawCode as keyof typeof POLICY_FAILURE_MESSAGES)
      : 'invalid_url';
    return failure(code, POLICY_FAILURE_MESSAGES[code]);
  }
};

/**
 * Executes a bounded outbound request after validating every DNS answer and
 * pinning the selected address into the socket lookup. Redirects are resolved,
 * revalidated and pinned independently, sharing one wall-clock timeout budget.
 * The function never exposes network/DNS exception text in its failure result.
 */
export const executeSafeOutboundHttp = async (
  input: ExecuteSafeOutboundHttpInput
): Promise<SafeOutboundHttpResult> => {
  const startedAt = Date.now();

  try {
    const methodResult = validateMethod(input.method);
    if (typeof methodResult !== 'string') {
      return withDuration(methodResult, startedAt);
    }

    const headerResult = validateRequestHeaders(
      input.headers,
      input.sensitiveHeaderNames
    );
    if ('kind' in headerResult) {
      return withDuration(headerResult, startedAt);
    }

    const bodyResult = normalizeBody(input.body);
    if (bodyResult && 'kind' in bodyResult) {
      return withDuration(bodyResult, startedAt);
    }

    const totalTimeoutMs = normalizeBoundedInteger({
      value: input.timeoutMs,
      fallback: SAFE_OUTBOUND_HTTP_DEFAULT_TIMEOUT_MS,
      minimum: 1,
      maximum: SAFE_OUTBOUND_HTTP_MAX_TIMEOUT_MS,
    });
    const responseLimitBytes = normalizeBoundedInteger({
      value: input.responseLimitBytes,
      fallback: SAFE_OUTBOUND_HTTP_MAX_RESPONSE_BYTES,
      minimum: 1,
      maximum: SAFE_OUTBOUND_HTTP_MAX_RESPONSE_BYTES,
    });
    const maximumRedirects = normalizeBoundedInteger({
      value: input.maxRedirects,
      fallback: SAFE_OUTBOUND_HTTP_MAX_REDIRECTS,
      minimum: 0,
      maximum: SAFE_OUTBOUND_HTTP_MAX_REDIRECTS,
    });

    let currentUrl = input.url;
    let currentMethod = methodResult;
    let currentHeaders = headerResult.headers;
    let currentBody = bodyResult;
    let redirectCount = 0;

    while (true) {
      const validated = validateUrl({
        url: currentUrl,
        isProduction: input.isProduction,
        allowLocalhostHttp: input.allowLocalhostHttp,
      });
      if ('kind' in validated) {
        return withDuration(validated, startedAt);
      }

      const resolved = await resolveWithTimeout({
        hostname: validated.url.hostname,
        allowsLoopback: validated.allowsLoopback,
        resolver: input.dnsResolver ?? defaultDnsResolver,
        timeoutMs: remainingTime(startedAt, totalTimeoutMs),
      });
      if ('kind' in resolved) {
        return withDuration(resolved, startedAt);
      }

      const response = await requestOnce({
        url: validated.url,
        method: currentMethod,
        headers: currentHeaders,
        body: currentBody,
        pinned: resolved,
        timeoutMs: remainingTime(startedAt, totalTimeoutMs),
        responseLimitBytes,
      });
      if (response.kind === 'failure') {
        return withDuration(response, startedAt);
      }

      const location = getHeader(response.headers, 'location');
      if (!REDIRECT_STATUS_CODES.has(response.statusCode) || !location) {
        return {
          ...response,
          finalUrl: validated.url.toString(),
          redirectCount,
          durationMs: Math.max(0, Date.now() - startedAt),
        };
      }

      if (redirectCount >= maximumRedirects) {
        return withDuration(
          failure(
            'too_many_redirects',
            'Outbound HTTP request exceeded the redirect limit'
          ),
          startedAt
        );
      }

      let nextUrl: URL;
      try {
        nextUrl = new URL(location, validated.url);
      } catch {
        return withDuration(
          failure('invalid_redirect', 'Outbound HTTP redirect URL is invalid'),
          startedAt
        );
      }

      if (nextUrl.origin !== validated.url.origin) {
        currentHeaders = stripSensitiveHeaders(
          currentHeaders,
          headerResult.sensitiveHeaderNames
        );
      }

      const nextMethod = redirectMethod({
        statusCode: response.statusCode,
        method: currentMethod,
      });
      if (nextMethod !== currentMethod) {
        currentBody = undefined;
        currentHeaders = stripBodyHeaders(currentHeaders);
      }

      currentMethod = nextMethod;
      currentUrl = nextUrl.toString();
      redirectCount += 1;
    }
  } catch {
    return withDuration(
      failure('internal_error', 'Outbound HTTP request could not be completed'),
      startedAt
    );
  }
};
