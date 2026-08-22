import { createHash } from 'node:crypto';
import {
  WORKER_COMMAND_ENVELOPE_V1_FIELDS,
  WORKER_COMMAND_MAX_AGE_MS,
  WORKER_COMMAND_MAX_BYTES,
  WORKER_COMMAND_PUBLIC_RETRY_WINDOW_MS,
  WORKER_COMMAND_PUBLISH_RECEIPT_V1_FIELDS,
  WORKER_COMMAND_SCHEMA_VERSION,
  WORKER_COMMAND_STREAM,
  WORKER_COMMAND_SUBJECT_PREFIX,
  WORKER_COMMAND_TYPES,
} from '@core/common/constants/workerCommandTransport';
import type {
  BuildWorkerCommandEnvelopeV1Input,
  WorkerCommandEnvelopeV1,
  WorkerCommandPublishReceiptV1,
  WorkerCommandType,
} from '@core/common/interfaces/IWorkerCommandEnvelope';

const UTF8_ENCODER = new TextEncoder();
const SHA256_HEX_PATTERN = /^[a-f0-9]{64}$/;
const SUBJECT_TOKEN_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/;
const IDENTIFIER_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:@/-]{0,255}$/;
const TRACEPARENT_PATTERN = /^00-[a-f0-9]{32}-[a-f0-9]{16}-[a-f0-9]{2}$/;
const CONTROL_CHARACTER_PATTERN = /[\u0000-\u001f\u007f]/;
const MAX_IDENTITY_LENGTH = 256;
const MAX_ENTITY_KEY_LENGTH = 512;
const MAX_ORIGIN_EPOCH_LENGTH = 512;

export type WorkerCommandContractErrorCode =
  | 'invalid_envelope'
  | 'invalid_receipt'
  | 'invalid_payload'
  | 'invalid_payload_digest'
  | 'invalid_worker_id'
  | 'invalid_deadline'
  | 'expired_command'
  | 'retry_window_elapsed'
  | 'envelope_too_large'
  | 'receipt_too_large';

export class WorkerCommandContractError extends Error {
  operationId?: string;
  commandId?: string;
  issuedAt?: string;
  expiresAt?: string;
  retryUntil?: string;

  constructor(
    readonly code: WorkerCommandContractErrorCode,
    message: string
  ) {
    super(message);
    this.name = 'WorkerCommandContractError';
  }
}

function fail(code: WorkerCommandContractErrorCode, message: string): never {
  throw new WorkerCommandContractError(code, message);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function assertExactFields(
  value: Record<string, unknown>,
  fields: readonly string[],
  code: 'invalid_envelope' | 'invalid_receipt'
): void {
  const actual = Object.keys(value).sort();
  const expected = [...fields].sort();

  if (
    actual.length !== expected.length ||
    actual.some((field, index) => field !== expected[index])
  ) {
    fail(code, `Campos invalidos: esperado ${expected.join(',')}`);
  }
}

function assertBoundedString(
  value: unknown,
  name: string,
  maxLength = MAX_IDENTITY_LENGTH,
  code: 'invalid_envelope' | 'invalid_receipt' = 'invalid_envelope'
): asserts value is string {
  if (
    typeof value !== 'string' ||
    value.length === 0 ||
    value.length > maxLength ||
    value.trim() !== value ||
    CONTROL_CHARACTER_PATTERN.test(value)
  ) {
    fail(code, `${name} deve ser uma string canonica e limitada`);
  }
}

function assertIdentifier(
  value: unknown,
  name: string,
  code: 'invalid_envelope' | 'invalid_receipt' = 'invalid_envelope'
): asserts value is string {
  if (typeof value !== 'string' || !IDENTIFIER_PATTERN.test(value)) {
    fail(code, `${name} deve ser um identificador canonico`);
  }
}

function assertNullableIdentifier(
  value: unknown,
  name: string
): asserts value is string | null {
  if (value === null) return;
  assertIdentifier(value, name);
}

function assertEntityKey(value: unknown): asserts value is string {
  if (
    typeof value !== 'string' ||
    Buffer.byteLength(value, 'utf8') > MAX_ENTITY_KEY_LENGTH ||
    /\s/.test(value) ||
    value.indexOf(':') < 1 ||
    value.endsWith(':')
  ) {
    fail('invalid_envelope', 'entity_key deve usar o formato canonico kind:id');
  }
}

function assertOriginEpoch(value: unknown): asserts value is string {
  assertBoundedString(value, 'origin_epoch', MAX_ORIGIN_EPOCH_LENGTH);
  if (Buffer.byteLength(value, 'utf8') > MAX_ORIGIN_EPOCH_LENGTH) {
    fail('invalid_envelope', 'origin_epoch excede 512 bytes');
  }
}

function assertPositiveSafeInteger(
  value: unknown,
  name: string,
  code: 'invalid_envelope' | 'invalid_receipt' = 'invalid_envelope'
): asserts value is number {
  if (!Number.isSafeInteger(value) || (value as number) < 1) {
    fail(code, `${name} deve ser um inteiro positivo seguro`);
  }
}

function parseCanonicalTimestamp(
  value: unknown,
  name: string,
  code: 'invalid_envelope' | 'invalid_receipt'
): number {
  if (typeof value !== 'string') {
    return fail(code, `${name} deve ser uma data ISO-8601 UTC`);
  }

  const timestamp = Date.parse(value);
  if (
    !Number.isFinite(timestamp) ||
    new Date(timestamp).toISOString() !== value
  ) {
    return fail(code, `${name} deve ser uma data ISO-8601 UTC canonica`);
  }

  return timestamp;
}

function canonicalizeJson(value: unknown, ancestors: Set<object>): string {
  if (value === null) return 'null';

  if (typeof value === 'string' || typeof value === 'boolean') {
    return JSON.stringify(value);
  }

  if (typeof value === 'number') {
    if (!Number.isFinite(value)) {
      return fail('invalid_payload', 'Numeros do payload devem ser finitos');
    }
    return JSON.stringify(value);
  }

  if (typeof value !== 'object') {
    return fail('invalid_payload', 'Payload deve conter somente valores JSON');
  }

  if (ancestors.has(value)) {
    return fail('invalid_payload', 'Payload JSON nao pode conter ciclos');
  }

  ancestors.add(value);
  try {
    if (Array.isArray(value)) {
      for (let index = 0; index < value.length; index += 1) {
        if (!Object.prototype.hasOwnProperty.call(value, index)) {
          return fail('invalid_payload', 'Arrays esparsos nao sao aceitos');
        }
      }
      return `[${value
        .map((item) => canonicalizeJson(item, ancestors))
        .join(',')}]`;
    }

    if (Object.getPrototypeOf(value) !== Object.prototype) {
      return fail('invalid_payload', 'Payload deve usar objetos JSON simples');
    }

    const ownKeys = Reflect.ownKeys(value);
    if (ownKeys.some((key) => typeof key !== 'string')) {
      return fail('invalid_payload', 'Payload nao pode conter chaves Symbol');
    }

    const descriptors = Object.getOwnPropertyDescriptors(value);
    if (
      ownKeys.some((key) => {
        const descriptor = descriptors[String(key)];
        return !descriptor?.enumerable || !('value' in descriptor);
      })
    ) {
      return fail(
        'invalid_payload',
        'Payload deve conter somente propriedades JSON enumeraveis'
      );
    }

    return `{${(ownKeys as string[])
      .sort()
      .map(
        (key) =>
          `${JSON.stringify(key)}:${canonicalizeJson(
            (value as Record<string, unknown>)[key],
            ancestors
          )}`
      )
      .join(',')}}`;
  } finally {
    ancestors.delete(value);
  }
}

export function canonicalWorkerCommandJson(value: unknown): string {
  return canonicalizeJson(value, new Set());
}

function sha256Hex(value: string | Uint8Array): string {
  return createHash('sha256').update(value).digest('hex');
}

export function computeWorkerCommandPayloadDigest(payload: unknown): string {
  return sha256Hex(canonicalWorkerCommandJson(payload));
}

export function isWorkerCommandType(
  value: unknown
): value is WorkerCommandType {
  return (
    typeof value === 'string' &&
    (WORKER_COMMAND_TYPES as readonly string[]).includes(value)
  );
}

export function workerCommandSubject(workerId: string): string {
  if (!SUBJECT_TOKEN_PATTERN.test(workerId)) {
    return fail(
      'invalid_worker_id',
      'worker_id deve ser um token NATS sem ponto ou wildcard'
    );
  }
  return `${WORKER_COMMAND_SUBJECT_PREFIX}.${workerId}`;
}

export function assertWorkerCommandEnvelopeV1(
  value: unknown
): asserts value is WorkerCommandEnvelopeV1 {
  if (!isRecord(value)) {
    return fail('invalid_envelope', 'Envelope deve ser um objeto');
  }
  assertExactFields(
    value,
    WORKER_COMMAND_ENVELOPE_V1_FIELDS,
    'invalid_envelope'
  );

  if (value.schema_version !== WORKER_COMMAND_SCHEMA_VERSION) {
    return fail('invalid_envelope', 'schema_version nao suportada');
  }

  assertIdentifier(value.command_id, 'command_id');
  assertIdentifier(value.operation_id, 'operation_id');
  assertNullableIdentifier(value.retry_of, 'retry_of');
  assertIdentifier(value.account_id, 'account_id');
  if (typeof value.worker_id !== 'string') {
    return fail('invalid_worker_id', 'worker_id deve ser uma string');
  }
  workerCommandSubject(value.worker_id);

  if (!isWorkerCommandType(value.command_type)) {
    return fail('invalid_envelope', 'command_type nao permitido');
  }

  assertEntityKey(value.entity_key);
  assertPositiveSafeInteger(value.entity_sequence, 'entity_sequence');
  assertNullableIdentifier(
    value.predecessor_operation_id,
    'predecessor_operation_id'
  );
  assertOriginEpoch(value.origin_epoch);
  assertPositiveSafeInteger(value.payload_version, 'payload_version');
  assertIdentifier(value.source, 'source');

  if (
    value.traceparent !== null &&
    (typeof value.traceparent !== 'string' ||
      !TRACEPARENT_PATTERN.test(value.traceparent))
  ) {
    return fail('invalid_envelope', 'traceparent W3C invalido');
  }

  const issuedAt = parseCanonicalTimestamp(
    value.issued_at,
    'issued_at',
    'invalid_envelope'
  );
  const deadlineAt = parseCanonicalTimestamp(
    value.deadline_at,
    'deadline_at',
    'invalid_envelope'
  );
  if (
    deadlineAt <= issuedAt ||
    deadlineAt - issuedAt > WORKER_COMMAND_MAX_AGE_MS
  ) {
    return fail(
      'invalid_deadline',
      'deadline_at deve estar depois de issued_at e dentro de 5 minutos'
    );
  }

  if (
    !isRecord(value.payload) ||
    Object.getPrototypeOf(value.payload) !== Object.prototype
  ) {
    return fail('invalid_payload', 'payload deve ser um objeto JSON');
  }
  const payloadDigest = computeWorkerCommandPayloadDigest(value.payload);
  if (
    typeof value.payload_digest !== 'string' ||
    !SHA256_HEX_PATTERN.test(value.payload_digest) ||
    value.payload_digest !== payloadDigest
  ) {
    return fail('invalid_payload_digest', 'payload_digest nao confere');
  }
}

export function assertWorkerCommandPublishable(
  envelope: unknown,
  nowMs = Date.now()
): asserts envelope is WorkerCommandEnvelopeV1 {
  assertWorkerCommandEnvelopeV1(envelope);
  const deadlineAt = Date.parse(envelope.deadline_at);

  if (nowMs >= deadlineAt) {
    return fail('expired_command', 'Comando ultrapassou deadline_at');
  }
}

export function assertWorkerCommandRetryable(
  envelope: unknown,
  nowMs = Date.now()
): asserts envelope is WorkerCommandEnvelopeV1 {
  assertWorkerCommandPublishable(envelope, nowMs);
  const issuedAt = Date.parse(envelope.issued_at);
  if (nowMs >= issuedAt + WORKER_COMMAND_PUBLIC_RETRY_WINDOW_MS) {
    return fail(
      'retry_window_elapsed',
      'Janela publica de retry de 2 minutos encerrada'
    );
  }
}

export function serializeWorkerCommandEnvelopeV1(
  envelope: unknown
): Uint8Array {
  assertWorkerCommandEnvelopeV1(envelope);
  const serialized = canonicalWorkerCommandJson(envelope);
  const encoded = UTF8_ENCODER.encode(serialized);
  if (encoded.byteLength > WORKER_COMMAND_MAX_BYTES) {
    return fail(
      'envelope_too_large',
      `Envelope excede ${WORKER_COMMAND_MAX_BYTES} bytes`
    );
  }
  return encoded;
}

export function buildWorkerCommandEnvelopeV1(
  input: BuildWorkerCommandEnvelopeV1Input
): WorkerCommandEnvelopeV1 {
  const envelope: WorkerCommandEnvelopeV1 = {
    schema_version: WORKER_COMMAND_SCHEMA_VERSION,
    command_id: input.command_id,
    operation_id: input.operation_id,
    retry_of: input.retry_of,
    account_id: input.account_id,
    worker_id: input.worker_id,
    command_type: input.command_type,
    entity_key: input.entity_key,
    entity_sequence: input.entity_sequence,
    predecessor_operation_id: input.predecessor_operation_id,
    origin_epoch: input.origin_epoch,
    issued_at: input.issued_at,
    deadline_at: input.deadline_at,
    payload_version: input.payload_version,
    payload_digest: computeWorkerCommandPayloadDigest(input.payload),
    payload: input.payload,
    traceparent: input.traceparent,
    source: input.source,
  };
  assertWorkerCommandEnvelopeV1(envelope);
  serializeWorkerCommandEnvelopeV1(envelope);
  return envelope;
}

export function assertWorkerCommandPublishReceiptV1(
  value: unknown
): asserts value is WorkerCommandPublishReceiptV1 {
  if (!isRecord(value)) {
    return fail('invalid_receipt', 'Receipt deve ser um objeto');
  }
  assertExactFields(
    value,
    WORKER_COMMAND_PUBLISH_RECEIPT_V1_FIELDS,
    'invalid_receipt'
  );
  assertIdentifier(value.command_id, 'command_id', 'invalid_receipt');
  assertIdentifier(value.operation_id, 'operation_id', 'invalid_receipt');
  if (value.stream !== WORKER_COMMAND_STREAM) {
    return fail('invalid_receipt', 'Receipt veio de stream inesperado');
  }
  assertPositiveSafeInteger(
    value.stream_sequence,
    'stream_sequence',
    'invalid_receipt'
  );
  if (typeof value.duplicate !== 'boolean') {
    return fail('invalid_receipt', 'duplicate deve ser booleano');
  }
  parseCanonicalTimestamp(value.accepted_at, 'accepted_at', 'invalid_receipt');
  parseCanonicalTimestamp(value.expires_at, 'expires_at', 'invalid_receipt');

  const encoded = UTF8_ENCODER.encode(canonicalWorkerCommandJson(value));
  if (encoded.byteLength > WORKER_COMMAND_MAX_BYTES) {
    return fail(
      'receipt_too_large',
      `Receipt excede ${WORKER_COMMAND_MAX_BYTES} bytes`
    );
  }
}

export function computeWorkerCommandPublishReceiptDigest(
  receipt: unknown
): string {
  assertWorkerCommandPublishReceiptV1(receipt);
  return sha256Hex(canonicalWorkerCommandJson(receipt));
}
