import { lookup as dnsLookup } from 'node:dns/promises';
import { request as requestHttp } from 'node:http';
import { request as requestHttps } from 'node:https';
import { isIP, type LookupFunction } from 'node:net';

export const OUTBOUND_WEBHOOK_MAX_PAYLOAD_BYTES = 1024 * 1024;
export const OUTBOUND_WEBHOOK_MAX_RESPONSE_BYTES = 64 * 1024;
export const OUTBOUND_WEBHOOK_REQUEST_TIMEOUT_MS = 10_000;
export const OUTBOUND_WEBHOOK_MAX_RETRY_AFTER_MS = 24 * 60 * 60 * 1000;

interface AddressRange {
  readonly address: string;
  readonly prefix: number;
}

const BLOCKED_IPV4_RANGES: readonly AddressRange[] = [
  { address: '0.0.0.0', prefix: 8 },
  { address: '10.0.0.0', prefix: 8 },
  { address: '100.64.0.0', prefix: 10 },
  { address: '127.0.0.0', prefix: 8 },
  { address: '169.254.0.0', prefix: 16 },
  { address: '172.16.0.0', prefix: 12 },
  { address: '192.0.0.0', prefix: 24 },
  { address: '192.0.2.0', prefix: 24 },
  { address: '192.88.99.0', prefix: 24 },
  { address: '192.168.0.0', prefix: 16 },
  { address: '198.18.0.0', prefix: 15 },
  { address: '198.51.100.0', prefix: 24 },
  { address: '203.0.113.0', prefix: 24 },
  { address: '224.0.0.0', prefix: 4 },
  { address: '240.0.0.0', prefix: 4 },
];

const BLOCKED_IPV6_RANGES: readonly AddressRange[] = [
  { address: '::', prefix: 128 },
  { address: '::1', prefix: 128 },
  { address: '::', prefix: 96 },
  // The well-known NAT64 prefix can encode private IPv4 targets (for example,
  // 64:ff9b::a00:1 -> 10.0.0.1). Block it before a host NAT64 gateway can
  // turn an otherwise public-looking IPv6 literal into an SSRF route.
  { address: '64:ff9b::', prefix: 96 },
  { address: '64:ff9b:1::', prefix: 48 },
  { address: '100::', prefix: 64 },
  { address: '2001::', prefix: 23 },
  { address: '2001:db8::', prefix: 32 },
  { address: '2002::', prefix: 16 },
  { address: 'fc00::', prefix: 7 },
  { address: 'fe80::', prefix: 10 },
  { address: 'fec0::', prefix: 10 },
  { address: 'ff00::', prefix: 8 },
];

const LOOPBACK_IPV4_RANGE: AddressRange = {
  address: '127.0.0.0',
  prefix: 8,
};
const LOOPBACK_IPV6_RANGE: AddressRange = { address: '::1', prefix: 128 };

export interface OutboundWebhookLookupAddress {
  readonly address: string;
  readonly family: 4 | 6;
}

export type OutboundWebhookDnsResolver = (
  hostname: string
) => Promise<readonly OutboundWebhookLookupAddress[]>;

export interface OutboundWebhookHttpMetadata {
  readonly event: string;
  readonly eventId: string;
  readonly deliveryId: string;
  readonly attempt: number;
  readonly webhookConfigVersion: number;
}

export interface DispatchOutboundWebhookHttpInput {
  readonly url: string;
  readonly rawBody: Buffer;
  readonly signature: string;
  readonly unixTimestamp: number;
  readonly metadata: OutboundWebhookHttpMetadata;
  readonly isProduction: boolean;
  readonly allowLocalhostHttp: boolean;
  readonly timeoutMs?: number;
  readonly responseLimitBytes?: number;
  readonly dnsResolver?: OutboundWebhookDnsResolver;
}

export interface OutboundWebhookHttpResponse {
  readonly kind: 'response';
  readonly statusCode: number;
  readonly responseBody: string;
  readonly retryAfterMs: number | null;
  readonly durationMs: number;
}

export interface OutboundWebhookHttpFailure {
  readonly kind: 'failure';
  readonly code: string;
  readonly message: string;
  readonly retryable: boolean;
  readonly isTimeout: boolean;
  readonly durationMs: number;
}

export type OutboundWebhookHttpResult =
  OutboundWebhookHttpResponse | OutboundWebhookHttpFailure;

export interface ValidatedOutboundWebhookUrl {
  readonly url: URL;
  readonly allowsLoopback: boolean;
}

export class OutboundWebhookHttpPolicyError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = 'OutboundWebhookHttpPolicyError';
    this.code = code;
  }
}

class OutboundWebhookTimeoutError extends Error {
  constructor() {
    super('Outbound webhook request timed out');
    this.name = 'OutboundWebhookTimeoutError';
  }
}

const normalizeHostname = (hostname: string): string =>
  hostname
    .replace(/^\[|\]$/gu, '')
    .replace(/%.*$/u, '')
    .toLowerCase();

const parseIpv4 = (address: string): bigint | null => {
  const octets = address.split('.');
  if (octets.length !== 4) {
    return null;
  }

  let result = 0n;
  for (const octet of octets) {
    if (!/^\d{1,3}$/u.test(octet)) {
      return null;
    }

    const value = Number(octet);
    if (value < 0 || value > 255) {
      return null;
    }

    result = (result << 8n) | BigInt(value);
  }

  return result;
};

const expandEmbeddedIpv4 = (address: string): string | null => {
  if (!address.includes('.')) {
    return address;
  }

  const lastColon = address.lastIndexOf(':');
  if (lastColon < 0) {
    return null;
  }

  const ipv4 = parseIpv4(address.slice(lastColon + 1));
  if (ipv4 === null) {
    return null;
  }

  const high = Number((ipv4 >> 16n) & 0xffffn).toString(16);
  const low = Number(ipv4 & 0xffffn).toString(16);
  return `${address.slice(0, lastColon)}:${high}:${low}`;
};

const parseIpv6 = (rawAddress: string): bigint | null => {
  const normalized = normalizeHostname(rawAddress);
  const address = expandEmbeddedIpv4(normalized);
  if (!address || address.split('::').length > 2) {
    return null;
  }

  const [leftRaw, rightRaw] = address.split('::');
  const left = leftRaw ? leftRaw.split(':') : [];
  const right = rightRaw ? rightRaw.split(':') : [];
  const missing = 8 - left.length - right.length;

  if (missing < 0 || (!address.includes('::') && missing !== 0)) {
    return null;
  }

  const groups = [
    ...left,
    ...Array.from({ length: missing }, () => '0'),
    ...right,
  ];
  if (groups.length !== 8) {
    return null;
  }

  let result = 0n;
  for (const group of groups) {
    if (!/^[\da-f]{1,4}$/iu.test(group)) {
      return null;
    }

    result = (result << 16n) | BigInt(`0x${group}`);
  }

  return result;
};

const isInRange = (address: string, range: AddressRange): boolean => {
  const family = isIP(normalizeHostname(address));
  const rangeFamily = isIP(range.address);
  if (family === 0 || family !== rangeFamily) {
    return false;
  }

  const bits = family === 4 ? 32 : 128;
  const parsedAddress = family === 4 ? parseIpv4(address) : parseIpv6(address);
  const parsedRange =
    family === 4 ? parseIpv4(range.address) : parseIpv6(range.address);
  if (parsedAddress === null || parsedRange === null) {
    return false;
  }

  const shift = BigInt(bits - range.prefix);
  return parsedAddress >> shift === parsedRange >> shift;
};

const extractMappedIpv4 = (address: string): string | null => {
  const normalized = normalizeHostname(address);
  const match = normalized.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/u);
  if (match?.[1]) {
    return match[1];
  }

  const parsed = parseIpv6(normalized);
  const mappedPrefix = parseIpv6('::ffff:0:0');
  if (parsed === null || mappedPrefix === null) {
    return null;
  }

  if (parsed >> 32n !== mappedPrefix >> 32n) {
    return null;
  }

  const value = Number(parsed & 0xffffffffn);
  return [
    value >>> 24,
    (value >>> 16) & 255,
    (value >>> 8) & 255,
    value & 255,
  ].join('.');
};

export const isLoopbackOutboundWebhookAddress = (address: string): boolean => {
  const normalized = normalizeHostname(address);
  const mappedIpv4 = extractMappedIpv4(normalized);
  if (mappedIpv4) {
    return isInRange(mappedIpv4, LOOPBACK_IPV4_RANGE);
  }

  return (
    isInRange(normalized, LOOPBACK_IPV4_RANGE) ||
    isInRange(normalized, LOOPBACK_IPV6_RANGE)
  );
};

export const isBlockedOutboundWebhookAddress = (address: string): boolean => {
  const normalized = normalizeHostname(address);
  const family = isIP(normalized);
  if (family === 0) {
    return true;
  }

  const mappedIpv4 = extractMappedIpv4(normalized);
  if (mappedIpv4) {
    return BLOCKED_IPV4_RANGES.some((range) => isInRange(mappedIpv4, range));
  }

  const ranges = family === 4 ? BLOCKED_IPV4_RANGES : BLOCKED_IPV6_RANGES;
  return ranges.some((range) => isInRange(normalized, range));
};

export const validateOutboundWebhookUrl = (input: {
  url: string;
  isProduction: boolean;
  allowLocalhostHttp: boolean;
}): ValidatedOutboundWebhookUrl => {
  let parsed: URL;
  try {
    parsed = new URL(input.url);
  } catch {
    throw new OutboundWebhookHttpPolicyError(
      'invalid_url',
      'Outbound webhook URL is invalid'
    );
  }

  if (parsed.username || parsed.password) {
    throw new OutboundWebhookHttpPolicyError(
      'url_credentials_forbidden',
      'Outbound webhook URL credentials are forbidden'
    );
  }

  if (parsed.hash) {
    throw new OutboundWebhookHttpPolicyError(
      'url_fragment_forbidden',
      'Outbound webhook URL fragments are forbidden'
    );
  }

  const hostname = normalizeHostname(parsed.hostname);
  const isLocalhostName = hostname === 'localhost';
  const isLoopbackLiteral =
    isIP(hostname) !== 0 && isLoopbackOutboundWebhookAddress(hostname);
  const allowsLoopback =
    !input.isProduction &&
    input.allowLocalhostHttp &&
    parsed.protocol === 'http:' &&
    (isLocalhostName || isLoopbackLiteral);

  if (parsed.protocol === 'http:') {
    if (!allowsLoopback) {
      throw new OutboundWebhookHttpPolicyError(
        'http_forbidden',
        'HTTP is allowed only for localhost development endpoints'
      );
    }
  } else if (parsed.protocol !== 'https:') {
    throw new OutboundWebhookHttpPolicyError(
      'protocol_forbidden',
      'Outbound webhook URL must use HTTPS'
    );
  }

  const effectivePort = Number(
    parsed.port || (parsed.protocol === 'https:' ? '443' : '80')
  );
  if (input.isProduction && effectivePort !== 443) {
    throw new OutboundWebhookHttpPolicyError(
      'port_forbidden',
      'Production outbound webhooks must use port 443'
    );
  }

  return { url: parsed, allowsLoopback };
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

const resolvePinnedAddress = async (input: {
  hostname: string;
  allowsLoopback: boolean;
  resolver: OutboundWebhookDnsResolver;
}): Promise<OutboundWebhookLookupAddress> => {
  const hostname = normalizeHostname(input.hostname);
  const addresses = await input.resolver(hostname);
  if (!addresses.length) {
    throw new OutboundWebhookHttpPolicyError(
      'dns_empty',
      'Outbound webhook hostname resolved to no addresses'
    );
  }

  for (const address of addresses) {
    if (isIP(normalizeHostname(address.address)) !== address.family) {
      throw new OutboundWebhookHttpPolicyError(
        'dns_invalid_address',
        'Outbound webhook hostname resolved to an invalid address'
      );
    }

    if (input.allowsLoopback) {
      if (!isLoopbackOutboundWebhookAddress(address.address)) {
        throw new OutboundWebhookHttpPolicyError(
          'dns_non_loopback_address',
          'Local development endpoint resolved outside loopback'
        );
      }
    } else if (isBlockedOutboundWebhookAddress(address.address)) {
      throw new OutboundWebhookHttpPolicyError(
        'dns_blocked_address',
        'Outbound webhook hostname resolved to a blocked address'
      );
    }
  }

  const pinned = addresses[0];
  if (!pinned) {
    throw new OutboundWebhookHttpPolicyError(
      'dns_empty',
      'Outbound webhook hostname resolved to no addresses'
    );
  }

  return pinned;
};

export const parseOutboundWebhookRetryAfter = (
  value: string | readonly string[] | undefined,
  nowMs: number,
  capMs: number = OUTBOUND_WEBHOOK_MAX_RETRY_AFTER_MS
): number | null => {
  const raw = Array.isArray(value) ? value[0] : value;
  if (!raw?.trim()) {
    return null;
  }

  const trimmed = raw.trim();
  let delayMs: number;
  if (/^\d+$/u.test(trimmed)) {
    delayMs = Number(trimmed) * 1000;
  } else {
    const retryAt = Date.parse(trimmed);
    if (!Number.isFinite(retryAt)) {
      return null;
    }
    delayMs = Math.max(0, retryAt - nowMs);
  }

  if (!Number.isFinite(delayMs) || delayMs < 0) {
    return null;
  }

  const normalizedCapMs = Number.isFinite(capMs)
    ? Math.max(0, Math.floor(capMs))
    : OUTBOUND_WEBHOOK_MAX_RETRY_AFTER_MS;
  return Math.min(Math.floor(delayMs), normalizedCapMs);
};

const toFailure = (input: {
  code: string;
  message: string;
  retryable: boolean;
  isTimeout?: boolean;
  startedAt: number;
}): OutboundWebhookHttpFailure => ({
  kind: 'failure',
  code: input.code,
  message: input.message,
  retryable: input.retryable,
  isTimeout: input.isTimeout ?? false,
  durationMs: Math.max(0, Date.now() - input.startedAt),
});

const decodeResponseBody = (chunks: readonly Buffer[]): string =>
  Buffer.concat(chunks).toString('utf8').replaceAll('\u0000', '\ufffd');

const normalizeBoundedPositiveInteger = (input: {
  value: number | undefined;
  fallback: number;
  maximum: number;
}): number => {
  const finiteValue = Number.isFinite(input.value)
    ? Math.floor(input.value as number)
    : input.fallback;
  return Math.max(1, Math.min(finiteValue, input.maximum));
};

const withTimeout = async <T>(
  promise: Promise<T>,
  timeoutMs: number
): Promise<T> => {
  let timeout: NodeJS.Timeout | undefined;
  const deadline = new Promise<never>((_resolve, reject) => {
    timeout = setTimeout(
      () => reject(new OutboundWebhookTimeoutError()),
      timeoutMs
    );
  });

  try {
    return await Promise.race([promise, deadline]);
  } finally {
    if (timeout) {
      clearTimeout(timeout);
    }
  }
};

/**
 * Delivers one signed request after resolving and validating every target IP.
 * Redirects are deliberately returned to the caller and are never followed.
 */
export const dispatchOutboundWebhookHttp = async (
  input: DispatchOutboundWebhookHttpInput
): Promise<OutboundWebhookHttpResult> => {
  const startedAt = Date.now();
  const totalTimeoutMs = normalizeBoundedPositiveInteger({
    value: input.timeoutMs,
    fallback: OUTBOUND_WEBHOOK_REQUEST_TIMEOUT_MS,
    maximum: OUTBOUND_WEBHOOK_REQUEST_TIMEOUT_MS,
  });

  if (input.rawBody.byteLength > OUTBOUND_WEBHOOK_MAX_PAYLOAD_BYTES) {
    return toFailure({
      code: 'payload_too_large',
      message: 'Outbound webhook payload exceeds 1 MiB',
      retryable: false,
      startedAt,
    });
  }

  let validated: ValidatedOutboundWebhookUrl;
  try {
    validated = validateOutboundWebhookUrl(input);
  } catch (error: unknown) {
    if (error instanceof OutboundWebhookHttpPolicyError) {
      return toFailure({
        code: error.code,
        message: error.message,
        retryable: false,
        startedAt,
      });
    }
    return toFailure({
      code: 'invalid_url',
      message: 'Outbound webhook URL validation failed',
      retryable: false,
      startedAt,
    });
  }

  let pinned: OutboundWebhookLookupAddress;
  try {
    const remainingMs = totalTimeoutMs - (Date.now() - startedAt);
    if (remainingMs <= 0) {
      throw new OutboundWebhookTimeoutError();
    }
    pinned = await withTimeout(
      resolvePinnedAddress({
        hostname: validated.url.hostname,
        allowsLoopback: validated.allowsLoopback,
        resolver: input.dnsResolver ?? defaultDnsResolver,
      }),
      remainingMs
    );
  } catch (error: unknown) {
    if (error instanceof OutboundWebhookTimeoutError) {
      return toFailure({
        code: 'timeout',
        message: error.message,
        retryable: true,
        isTimeout: true,
        startedAt,
      });
    }
    if (error instanceof OutboundWebhookHttpPolicyError) {
      return toFailure({
        code: error.code,
        message: error.message,
        retryable: false,
        startedAt,
      });
    }

    const message =
      error instanceof Error ? error.message : 'DNS lookup failed';
    return toFailure({
      code: 'dns_error',
      message,
      retryable: true,
      startedAt,
    });
  }

  const timeoutMs = totalTimeoutMs - (Date.now() - startedAt);
  if (timeoutMs <= 0) {
    return toFailure({
      code: 'timeout',
      message: 'Outbound webhook request timed out',
      retryable: true,
      isTimeout: true,
      startedAt,
    });
  }
  const responseLimitBytes = normalizeBoundedPositiveInteger({
    value: input.responseLimitBytes,
    fallback: OUTBOUND_WEBHOOK_MAX_RESPONSE_BYTES,
    maximum: OUTBOUND_WEBHOOK_MAX_RESPONSE_BYTES,
  });
  const pinnedLookup: LookupFunction = (_hostname, options, callback) => {
    if (options.all) {
      callback(null, [pinned]);
      return;
    }
    callback(null, pinned.address, pinned.family);
  };
  const request =
    validated.url.protocol === 'https:' ? requestHttps : requestHttp;

  return new Promise<OutboundWebhookHttpResult>((resolve) => {
    let hasSettled = false;
    let hasTimedOut = false;
    let timeout: NodeJS.Timeout | undefined;

    const finish = (result: OutboundWebhookHttpResult): void => {
      if (hasSettled) {
        return;
      }
      hasSettled = true;
      if (timeout) {
        clearTimeout(timeout);
      }
      resolve(result);
    };

    const clientRequest = request(
      validated.url,
      {
        method: 'POST',
        agent: false,
        lookup: pinnedLookup,
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': String(input.rawBody.byteLength),
          'X-Underchat-Signature': input.signature,
          'X-Underchat-Timestamp': String(Math.floor(input.unixTimestamp)),
          'X-Underchat-Event': input.metadata.event,
          'X-Underchat-Event-Id': input.metadata.eventId,
          'X-Underchat-Delivery-Id': input.metadata.deliveryId,
          'X-Underchat-Attempt': String(input.metadata.attempt),
          'X-Underchat-Webhook-Config-Version': String(
            input.metadata.webhookConfigVersion
          ),
        },
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
          if (receivedBytes > responseLimitBytes) {
            finish(
              toFailure({
                code: 'response_too_large',
                message: 'Outbound webhook response exceeds 64 KiB',
                retryable: true,
                startedAt,
              })
            );
            response.destroy();
            clientRequest.destroy();
            return;
          }
          chunks.push(buffer);
        });

        response.once('aborted', () => {
          finish(
            toFailure({
              code: 'response_aborted',
              message: 'Outbound webhook response was aborted',
              retryable: true,
              startedAt,
            })
          );
        });

        response.once('error', (error: Error) => {
          finish(
            toFailure({
              code: 'response_error',
              message: error.message,
              retryable: true,
              startedAt,
            })
          );
        });

        response.once('end', () => {
          const statusCode = response.statusCode ?? 0;
          if (statusCode < 100 || statusCode > 599) {
            finish(
              toFailure({
                code: 'invalid_http_status',
                message: 'Outbound webhook returned an invalid HTTP status',
                retryable: true,
                startedAt,
              })
            );
            return;
          }

          finish({
            kind: 'response',
            statusCode,
            responseBody: decodeResponseBody(chunks),
            retryAfterMs: parseOutboundWebhookRetryAfter(
              response.headers['retry-after'],
              Date.now()
            ),
            durationMs: Math.max(0, Date.now() - startedAt),
          });
        });
      }
    );

    timeout = setTimeout(() => {
      hasTimedOut = true;
      clientRequest.destroy(new Error('Outbound webhook request timed out'));
    }, timeoutMs);
    timeout.unref();

    clientRequest.once('error', (error: NodeJS.ErrnoException) => {
      finish(
        toFailure({
          code: hasTimedOut ? 'timeout' : (error.code ?? 'network_error'),
          message: error.message,
          retryable: true,
          isTimeout: hasTimedOut,
          startedAt,
        })
      );
    });

    clientRequest.end(input.rawBody);
  });
};
