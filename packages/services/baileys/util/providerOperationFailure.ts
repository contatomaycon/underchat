export type BaileysProviderOperationFailureKind =
  | 'operation_rejected'
  | 'session_terminal'
  | 'transport'
  | 'protocol'
  | 'unknown';

export type BaileysProviderOperationFailureReason =
  | 'provider_not_authorized'
  | 'provider_item_not_found'
  | 'provider_operation_forbidden'
  | 'provider_connection_lost'
  | 'provider_connection_closed'
  | 'provider_connection_replaced'
  | 'provider_multidevice_mismatch'
  | 'provider_session_logged_out'
  | 'provider_session_forbidden'
  | 'provider_bad_session'
  | 'provider_restart_required'
  | 'provider_network_error'
  | 'provider_protocol_invalid_response'
  | 'provider_operation_response'
  | 'unclassified_provider_error';

export interface BaileysProviderOperationFailure {
  kind: BaileysProviderOperationFailureKind;
  reason: BaileysProviderOperationFailureReason;
  statusCode?: number;
}

const MAX_CAUSE_DEPTH = 5;
export const BAILEYS_PROVIDER_PROTOCOL_FAILURE_CODE =
  'BAILEYS_PROVIDER_PROTOCOL_FAILURE';
const OPERATION_REJECTIONS = new Map<
  string,
  { reason: BaileysProviderOperationFailureReason; statusCode: number }
>([
  ['not-authorized', { reason: 'provider_not_authorized', statusCode: 401 }],
  ['item-not-found', { reason: 'provider_item_not_found', statusCode: 404 }],
  ['forbidden', { reason: 'provider_operation_forbidden', statusCode: 403 }],
]);
const TRANSPORT_STATUS_REASONS = new Map<
  number,
  BaileysProviderOperationFailureReason
>([
  [408, 'provider_connection_lost'],
  [428, 'provider_connection_closed'],
  [515, 'provider_restart_required'],
]);
const SESSION_TERMINAL_STATUS_REASONS = new Map<
  number,
  BaileysProviderOperationFailureReason
>([
  [401, 'provider_session_logged_out'],
  [403, 'provider_session_forbidden'],
  [411, 'provider_multidevice_mismatch'],
  [440, 'provider_connection_replaced'],
  [500, 'provider_bad_session'],
]);
const TRANSPORT_ERROR_CODES = new Set([
  'BAILEYS_SEND_MESSAGE_TIMEOUT',
  'WHATSAPP_PROVIDER_AUXILIARY_TIMEOUT',
  'ECONNABORTED',
  'ECONNREFUSED',
  'ECONNRESET',
  'EHOSTUNREACH',
  'ENETDOWN',
  'ENETUNREACH',
  'ENOTFOUND',
  'EPIPE',
  'ERR_SOCKET_CLOSED',
  'ERR_STREAM_DESTROYED',
  'ETIMEDOUT',
  'UND_ERR_CONNECT_TIMEOUT',
  'UND_ERR_SOCKET',
]);
const TRANSPORT_ERROR_MESSAGES = new Set([
  'connection closed',
  'connection terminated',
  'connection terminated by server',
  'connection was lost',
  'no connection established',
  'socket closed',
  'socket hang up',
  'socket is closed',
  'socket is not open',
  'socket not connected',
  'websocket is not open',
]);

export class BaileysProviderProtocolFailureError extends Error {
  readonly code = BAILEYS_PROVIDER_PROTOCOL_FAILURE_CODE;

  constructor(message: string) {
    super(message);
    this.name = 'BaileysProviderProtocolFailureError';
  }
}

function ownDataProperty(value: object, property: string): unknown {
  try {
    const descriptor = Object.getOwnPropertyDescriptor(value, property);
    return descriptor && 'value' in descriptor ? descriptor.value : undefined;
  } catch {
    return undefined;
  }
}

function asObject(value: unknown): object | undefined {
  return value !== null &&
    (typeof value === 'object' || typeof value === 'function')
    ? (value as object)
    : undefined;
}

function finiteStatusCode(value: unknown): number | undefined {
  if (typeof value !== 'number' || !Number.isSafeInteger(value)) {
    return undefined;
  }
  return value >= 100 && value <= 999 ? value : undefined;
}

interface ProviderStatusEvidence {
  codes: number[];
  legacyOperationCode?: number;
}

function statusEvidence(value: object): ProviderStatusEvidence {
  const output = asObject(ownDataProperty(value, 'output'));
  const outputCode = finiteStatusCode(
    output ? ownDataProperty(output, 'statusCode') : undefined
  );
  const directCode = finiteStatusCode(ownDataProperty(value, 'statusCode'));
  const dataCode = finiteStatusCode(ownDataProperty(value, 'data'));

  // Baileys <= 1.0.34 stored IQ stanza codes only in Boom.data, leaving
  // Boom.output.statusCode at its default 500. That 500 is not evidence of a
  // bad session and must not participate in socket-health classification.
  if (
    outputCode === 500 &&
    directCode === undefined &&
    dataCode !== undefined &&
    dataCode !== 500
  ) {
    return { codes: [], legacyOperationCode: dataCode };
  }

  return {
    codes: [...new Set([outputCode, directCode, dataCode])].filter(
      (code): code is number => code !== undefined
    ),
  };
}

function normalizedMessage(value: object): string | undefined {
  const message = ownDataProperty(value, 'message');
  if (typeof message !== 'string') {
    return undefined;
  }
  const normalized = message.trim().toLowerCase();
  return normalized && normalized.length <= 160 ? normalized : undefined;
}

function normalizedCode(value: object): string | undefined {
  const code = ownDataProperty(value, 'code');
  if (typeof code !== 'string') {
    return undefined;
  }
  const normalized = code.trim().toUpperCase();
  return normalized && normalized.length <= 64 ? normalized : undefined;
}

function errorChain(error: unknown): object[] {
  const chain: object[] = [];
  const visited = new Set<object>();
  let current: unknown = error;

  for (let depth = 0; depth < MAX_CAUSE_DEPTH; depth += 1) {
    const object = asObject(current);
    if (!object || visited.has(object)) {
      break;
    }
    visited.add(object);
    chain.push(object);
    current =
      ownDataProperty(object, 'cause') ??
      ownDataProperty(object, 'originalError');
  }

  return chain;
}

/**
 * Separates a rejected Baileys operation from evidence that the socket itself
 * is unhealthy. Session termination remains authoritative through
 * `connection.update`; a known operation-level rejection must never tear down
 * a socket that is still exchanging stanzas successfully.
 */
export function classifyBaileysProviderOperationFailure(
  error: unknown
): BaileysProviderOperationFailure {
  const evidence = errorChain(error).map((item) => ({
    item,
    status: statusEvidence(item),
  }));

  for (const { item, status } of evidence) {
    const message = normalizedMessage(item);
    const rejection = message ? OPERATION_REJECTIONS.get(message) : undefined;
    const itemCodes = [status.legacyOperationCode, ...status.codes];
    if (rejection && itemCodes.includes(rejection.statusCode)) {
      return {
        kind: 'operation_rejected',
        reason: rejection.reason,
        statusCode: rejection.statusCode,
      };
    }
  }

  for (const { status } of evidence) {
    for (const code of status.codes) {
      const transportReason = TRANSPORT_STATUS_REASONS.get(code);
      if (transportReason) {
        return {
          kind: 'transport',
          reason: transportReason,
          statusCode: code,
        };
      }
    }
  }

  for (const { status } of evidence) {
    for (const code of status.codes) {
      const sessionReason = SESSION_TERMINAL_STATUS_REASONS.get(code);
      if (sessionReason) {
        return {
          kind: 'session_terminal',
          reason: sessionReason,
          statusCode: code,
        };
      }
    }
  }

  for (const { item } of evidence) {
    const code = normalizedCode(item);
    const message = normalizedMessage(item);
    if (code === BAILEYS_PROVIDER_PROTOCOL_FAILURE_CODE) {
      return {
        kind: 'protocol',
        reason: 'provider_protocol_invalid_response',
      };
    }
    if (
      (code && TRANSPORT_ERROR_CODES.has(code)) ||
      (message &&
        (TRANSPORT_ERROR_MESSAGES.has(message) ||
          message.startsWith('websocket error (')))
    ) {
      return {
        kind: 'transport',
        reason: 'provider_network_error',
      };
    }
  }

  const legacyOperationCode = evidence.find(
    ({ status }) => status.legacyOperationCode !== undefined
  )?.status.legacyOperationCode;
  if (legacyOperationCode !== undefined) {
    return {
      kind: 'unknown',
      reason: 'provider_operation_response',
      statusCode: legacyOperationCode,
    };
  }

  const unclassifiedStatus = evidence
    .flatMap(({ status }) => status.codes)
    .at(0);

  return {
    kind: 'unknown',
    reason: 'unclassified_provider_error',
    ...(unclassifiedStatus !== undefined
      ? { statusCode: unclassifiedStatus }
      : {}),
  };
}
