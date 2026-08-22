import {
  WORKER_COMMAND_ENVELOPE_V1_FIELDS,
  WORKER_COMMAND_MAX_BYTES,
  WORKER_COMMAND_STREAM,
  WORKER_COMMAND_TYPES,
} from '@core/common/constants/workerCommandTransport';
import {
  assertWorkerCommandPublishReceiptV1,
  assertWorkerCommandRetryable,
  buildWorkerCommandEnvelopeV1,
  canonicalWorkerCommandJson,
  computeWorkerCommandPayloadDigest,
  computeWorkerCommandPublishReceiptDigest,
  serializeWorkerCommandEnvelopeV1,
  WorkerCommandContractError,
  workerCommandSubject,
} from '@core/common/functions/workerCommandEnvelope';
import type {
  BuildWorkerCommandEnvelopeV1Input,
  WorkerCommandPublishReceiptV1,
} from '@core/common/interfaces/IWorkerCommandEnvelope';

const ISSUED_AT = Date.parse('2026-08-13T00:00:00.000Z');

function input(
  overrides: Partial<BuildWorkerCommandEnvelopeV1Input> = {}
): BuildWorkerCommandEnvelopeV1Input {
  return {
    command_id: 'command-1',
    operation_id: 'operation-1',
    retry_of: null,
    account_id: 'account-1',
    worker_id: 'worker_1',
    command_type: 'direct_send',
    entity_key: 'chat:chat-1',
    entity_sequence: 1,
    predecessor_operation_id: null,
    origin_epoch: 'epoch-01J5A7WJAG85HE9XH9K2MZ1C0Q',
    issued_at: new Date(ISSUED_AT).toISOString(),
    deadline_at: new Date(ISSUED_AT + 5 * 60 * 1000).toISOString(),
    payload_version: 1,
    payload: { message: { text: 'ola' }, chat_id: 'chat-1' },
    traceparent: '00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01',
    source: 'service-api',
    ...overrides,
  };
}

describe('WorkerCommandEnvelopeV1 contract', () => {
  it('builds only the exact V1 fields and a deterministic payload digest', () => {
    const first = buildWorkerCommandEnvelopeV1(
      input({ payload: { z: 1, nested: { b: true, a: null }, a: 'x' } })
    );
    const second = buildWorkerCommandEnvelopeV1(
      input({ payload: { a: 'x', nested: { a: null, b: true }, z: 1 } })
    );

    expect(Object.keys(first).sort()).toEqual(
      [...WORKER_COMMAND_ENVELOPE_V1_FIELDS].sort()
    );
    expect(first.payload_digest).toBe(second.payload_digest);
    expect(first.payload_digest).toBe(
      computeWorkerCommandPayloadDigest(first.payload)
    );
    expect(first.origin_epoch).toBe('epoch-01J5A7WJAG85HE9XH9K2MZ1C0Q');
  });

  it('uses canonical JSON and rejects values that are not portable JSON', () => {
    expect(canonicalWorkerCommandJson({ z: 1, a: [true, null] })).toBe(
      '{"a":[true,null],"z":1}'
    );
    expect(() =>
      computeWorkerCommandPayloadDigest({ value: Number.NaN })
    ).toThrow(WorkerCommandContractError);
    expect(() =>
      computeWorkerCommandPayloadDigest({ value: undefined } as never)
    ).toThrow(WorkerCommandContractError);
    expect(() =>
      buildWorkerCommandEnvelopeV1(input({ payload: [] as never }))
    ).toThrow('payload deve ser um objeto JSON');
  });

  it('keeps the command type whitelist explicit and excludes validate_phone', () => {
    expect(WORKER_COMMAND_TYPES).toEqual([
      'direct_send',
      'schedule_send',
      'notification_send',
      'mark_read',
      'worker_config',
      'provider_command',
      'webhook_integration',
    ]);
    expect(WORKER_COMMAND_TYPES).not.toContain('validate_phone' as never);
    expect(() =>
      buildWorkerCommandEnvelopeV1(
        input({ command_type: 'validate_phone' as never })
      )
    ).toThrow('command_type nao permitido');
  });

  it('creates exactly one safe per-worker subject token', () => {
    expect(workerCommandSubject('worker_A-1')).toBe(
      'uc.worker.command.worker_A-1'
    );
    for (const unsafe of ['worker.1', 'worker*', 'worker>', ' worker']) {
      expect(() => workerCommandSubject(unsafe)).toThrow('worker_id');
    }
    expect(() =>
      buildWorkerCommandEnvelopeV1(input({ worker_id: null as never }))
    ).toThrow('worker_id deve ser uma string');
  });

  it('rejects a deadline beyond the hardcoded five minute horizon', () => {
    expect(() =>
      buildWorkerCommandEnvelopeV1(
        input({
          deadline_at: new Date(ISSUED_AT + 5 * 60 * 1000 + 1).toISOString(),
        })
      )
    ).toThrow('dentro de 5 minutos');
  });

  it('requires a canonical entity lane key shared with workers', () => {
    expect(() =>
      buildWorkerCommandEnvelopeV1(input({ entity_key: 'chat-1' }))
    ).toThrow('kind:id');
    expect(() =>
      buildWorkerCommandEnvelopeV1(input({ entity_key: 'chat:chat 1' }))
    ).toThrow('kind:id');
  });

  it('allows initial delivery until deadline but rejects public retry after two minutes', () => {
    const command = buildWorkerCommandEnvelopeV1(input());

    expect(() =>
      assertWorkerCommandRetryable(command, ISSUED_AT + 2 * 60 * 1000 - 1)
    ).not.toThrow();
    expect(() =>
      assertWorkerCommandRetryable(command, ISSUED_AT + 2 * 60 * 1000)
    ).toThrow('2 minutos');
  });

  it('enforces the 64 KiB encoded envelope limit', () => {
    expect(() =>
      buildWorkerCommandEnvelopeV1(
        input({ payload: { text: 'a'.repeat(WORKER_COMMAND_MAX_BYTES) } })
      )
    ).toThrow(`excede ${WORKER_COMMAND_MAX_BYTES} bytes`);

    const normal = buildWorkerCommandEnvelopeV1(input());
    expect(serializeWorkerCommandEnvelopeV1(normal).byteLength).toBeLessThan(
      WORKER_COMMAND_MAX_BYTES
    );
  });

  it('validates and digests the local PubAck receipt without extra fields', () => {
    const receipt: WorkerCommandPublishReceiptV1 = {
      command_id: 'command-1',
      operation_id: 'operation-1',
      stream: WORKER_COMMAND_STREAM,
      stream_sequence: 7,
      duplicate: false,
      accepted_at: '2026-08-13T00:00:01.000Z',
      expires_at: '2026-08-13T00:05:00.000Z',
    };

    expect(() => assertWorkerCommandPublishReceiptV1(receipt)).not.toThrow();
    expect(computeWorkerCommandPublishReceiptDigest(receipt)).toMatch(
      /^[a-f0-9]{64}$/
    );
    expect(() =>
      assertWorkerCommandPublishReceiptV1({ ...receipt, payload: {} })
    ).toThrow('Campos invalidos');
  });
});
