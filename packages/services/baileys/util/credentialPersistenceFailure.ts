import {
  workerErrorDiagnostics,
  type WorkerErrorDiagnostics,
} from '@core/common/functions/workerErrorDiagnostics';

export interface BaileysCredentialPersistenceDiagnostics extends WorkerErrorDiagnostics {
  native_error_code: string;
  postgres_error_code: string;
  postgres_message_error_code: string;
}

const MAX_CAUSE_DEPTH = 5;
const SQLSTATE_PATTERN = /^[0-9A-Z]{5}$/;
const SAFE_BAILEYS_ERROR_CODE_PATTERN = /^BAILEYS_[A-Z0-9_]{2,56}$/i;
const UNKNOWN_NATIVE_CODE = 'native_error_code_unavailable';
const UNKNOWN_SQLSTATE = 'postgres_sqlstate_unavailable';
const REDACTED_MESSAGE = 'persistence_error_message_redacted';

const POSTGRES_MESSAGE_CODES = new Map<string, string>([
  [
    'whatsapp session changed during pairing finalization',
    'whatsapp_session_changed_during_pairing_finalization',
  ],
  [
    'paired whatsapp session identity is incomplete',
    'paired_whatsapp_session_identity_is_incomplete',
  ],
  [
    'could not serialize access due to concurrent update',
    'postgres_serialization_concurrent_update',
  ],
  [
    'could not serialize access due to read/write dependencies among transactions',
    'postgres_serialization_dependency_conflict',
  ],
]);

const POSTGRES_SQLSTATE_MESSAGE_CODES = new Map<string, string>([
  ['40001', 'postgres_serialization_failure'],
  ['23514', 'postgres_check_violation'],
  ['23505', 'postgres_unique_violation'],
  ['08006', 'postgres_connection_failure'],
  ['53300', 'postgres_too_many_connections'],
  ['57P01', 'postgres_admin_shutdown'],
]);

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

function errorChain(error: unknown): object[] {
  const chain: object[] = [];
  const visited = new Set<object>();
  let current: unknown = error;

  for (let depth = 0; depth < MAX_CAUSE_DEPTH; depth += 1) {
    const object = asObject(current);
    if (!object || visited.has(object)) break;
    visited.add(object);
    chain.push(object);
    current =
      ownDataProperty(object, 'cause') ??
      ownDataProperty(object, 'originalError');
  }

  return chain;
}

function postgresSqlstate(chain: readonly object[]): string | undefined {
  for (const item of chain) {
    for (const property of ['code', 'Code']) {
      const value = ownDataProperty(item, property);
      if (typeof value !== 'string') continue;
      const candidate = value.trim().toUpperCase();
      if (SQLSTATE_PATTERN.test(candidate)) return candidate;
    }
  }
  return undefined;
}

function baileysErrorCode(chain: readonly object[]): string | undefined {
  for (const item of chain) {
    for (const property of ['code', 'Code']) {
      const value = ownDataProperty(item, property);
      if (typeof value !== 'string') continue;
      const candidate = value.trim();
      if (SAFE_BAILEYS_ERROR_CODE_PATTERN.test(candidate)) {
        return candidate.toLowerCase();
      }
    }
  }
  return undefined;
}

function postgresMessageCode(
  chain: readonly object[],
  sqlstate: string | undefined
): string {
  for (const item of chain) {
    const message = ownDataProperty(item, 'message');
    if (typeof message !== 'string' || message.length > 160) continue;
    const known = POSTGRES_MESSAGE_CODES.get(message.trim().toLowerCase());
    if (known) return known;
  }

  return sqlstate
    ? (POSTGRES_SQLSTATE_MESSAGE_CODES.get(sqlstate) ?? REDACTED_MESSAGE)
    : REDACTED_MESSAGE;
}

/**
 * Produces persistence diagnostics without ever returning an arbitrary error
 * message. PostgreSQL text is observable only through exact, application-owned
 * classifications; unknown text remains redacted even when it looks harmless.
 */
export function baileysCredentialPersistenceDiagnostics(
  error: unknown
): BaileysCredentialPersistenceDiagnostics {
  const chain = errorChain(error);
  const sqlstate = postgresSqlstate(chain);
  const diagnostics = workerErrorDiagnostics(error);
  const nativeCode = baileysErrorCode(chain);

  return {
    ...diagnostics,
    native_error_code: nativeCode ?? UNKNOWN_NATIVE_CODE,
    postgres_error_code: sqlstate
      ? `sqlstate_${sqlstate.toLowerCase()}`
      : UNKNOWN_SQLSTATE,
    postgres_message_error_code: postgresMessageCode(chain, sqlstate),
  };
}
