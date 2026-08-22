import { TimeoutError, type NatsConnection } from '@nats-io/transport-node';
import type { JetStreamClient, PubAck } from '@nats-io/jetstream';
import {
  WORKER_COMMAND_STREAM,
  WORKER_COMMAND_STREAM_LIMITS,
} from '@core/common/constants/workerCommandTransport';
import { buildWorkerCommandEnvelopeV1 } from '@core/common/functions/workerCommandEnvelope';
import type { WorkerCommandEnvelopeV1 } from '@core/common/interfaces/IWorkerCommandEnvelope';
import {
  NatsJetStreamPublisher,
  natsJetStreamPublisherOptionsFromEnvironment,
  natsNodeConnectionOptions,
  type NatsJetStreamPublisherDependencies,
} from '@core/services/natsJetStreamPublisher.service';

const ISSUED_AT = Date.parse('2026-08-13T00:00:00.000Z');
const PUBLISHER_OPTIONS = {
  servers: ['nats://nats-1:4222'],
  user: 'runtime-user',
  password: 'runtime-password',
} as const;

function command(): WorkerCommandEnvelopeV1 {
  return buildWorkerCommandEnvelopeV1({
    command_id: 'command-1',
    operation_id: 'operation-1',
    retry_of: null,
    account_id: 'account-1',
    worker_id: 'worker-1',
    command_type: 'direct_send',
    entity_key: 'chat:chat-1',
    entity_sequence: 2,
    predecessor_operation_id: 'operation-0',
    origin_epoch: 'opaque-epoch-7',
    issued_at: new Date(ISSUED_AT).toISOString(),
    deadline_at: new Date(ISSUED_AT + 5 * 60 * 1000).toISOString(),
    payload_version: 1,
    payload: { chat_id: 'chat-1', text: 'oi' },
    traceparent: null,
    source: 'contract-test',
  });
}

function connection(): NatsConnection {
  return {
    closed: jest.fn(() => new Promise(() => undefined)),
    isClosed: jest.fn(() => false),
    isDraining: jest.fn(() => false),
    drain: jest.fn(async () => undefined),
  } as unknown as NatsConnection;
}

function dependencies(
  publish: jest.Mock,
  times: number[] = [ISSUED_AT + 1_000, ISSUED_AT + 1_001, ISSUED_AT + 1_002]
): {
  value: NatsJetStreamPublisherDependencies;
  connect: jest.Mock;
  sleep: jest.Mock;
  jetStream: JetStreamClient;
} {
  const connect = jest.fn(async () => connection());
  const sleep = jest.fn(async () => undefined);
  let lastTime = times.at(-1) ?? ISSUED_AT + 1_002;
  const now = jest.fn(() => {
    const nextTime = times.shift();
    if (nextTime !== undefined) lastTime = nextTime;
    return lastTime;
  });
  const jetStream = { publish } as unknown as JetStreamClient;
  return {
    value: {
      connect,
      jetstream: jest.fn(() => jetStream),
      now,
      sleep,
    },
    connect,
    sleep,
    jetStream,
  };
}

describe('NatsJetStreamPublisher contract', () => {
  it('publishes with Nats-Msg-Id semantics, expected stream and PubAck receipt', async () => {
    const publish = jest.fn<
      Promise<PubAck>,
      Parameters<JetStreamClient['publish']>
    >(async () => ({
      stream: WORKER_COMMAND_STREAM,
      seq: 42,
      duplicate: false,
    }));
    const deps = dependencies(publish);
    const publisher = new NatsJetStreamPublisher(PUBLISHER_OPTIONS, deps.value);

    const receipt = await publisher.publishCommand(command());

    expect(publish).toHaveBeenCalledTimes(1);
    const [subject, encoded, options] = publish.mock.calls[0];
    expect(subject).toBe('uc.worker.command.worker-1');
    expect(
      JSON.parse(new TextDecoder().decode(encoded as Uint8Array))
    ).toMatchObject({
      command_id: 'command-1',
      origin_epoch: 'opaque-epoch-7',
    });
    expect(options).toMatchObject({
      msgID: 'command-1',
      expect: { streamName: WORKER_COMMAND_STREAM },
      retries: 0,
    });
    expect(receipt).toEqual({
      command_id: 'command-1',
      operation_id: 'operation-1',
      stream: WORKER_COMMAND_STREAM,
      stream_sequence: 42,
      duplicate: false,
      accepted_at: '2026-08-13T00:00:01.002Z',
      expires_at: '2026-08-13T00:05:00.000Z',
    });
  });

  it('retries retryable PubAck failures with the same command key', async () => {
    const publish = jest
      .fn()
      .mockRejectedValueOnce(new TimeoutError())
      .mockResolvedValueOnce({
        stream: WORKER_COMMAND_STREAM,
        seq: 43,
        duplicate: true,
      });
    const deps = dependencies(publish, [
      ISSUED_AT + 1_000,
      ISSUED_AT + 1_001,
      ISSUED_AT + 1_002,
      ISSUED_AT + 1_102,
      ISSUED_AT + 1_103,
      ISSUED_AT + 1_104,
    ]);
    const publisher = new NatsJetStreamPublisher(PUBLISHER_OPTIONS, deps.value);

    await expect(publisher.publishCommand(command())).resolves.toMatchObject({
      duplicate: true,
      stream_sequence: 43,
    });
    expect(deps.sleep).toHaveBeenCalledWith(100);
    expect(publish.mock.calls.map((call) => call[2]?.msgID)).toEqual([
      'command-1',
      'command-1',
    ]);
  });

  it('permits first publish after two minutes but never automatic retry then', async () => {
    const publish = jest.fn().mockRejectedValue(new TimeoutError());
    const deps = dependencies(publish, [
      ISSUED_AT + 3 * 60 * 1000,
      ISSUED_AT + 3 * 60 * 1000,
      ISSUED_AT + 3 * 60 * 1000,
    ]);
    const publisher = new NatsJetStreamPublisher(PUBLISHER_OPTIONS, deps.value);

    await expect(publisher.publishCommand(command())).rejects.toMatchObject({
      code: 'transport_unavailable',
    });
    expect(publish).toHaveBeenCalledTimes(1);
    expect(deps.sleep).not.toHaveBeenCalled();
  });

  it('rejects an explicit public retry after the two minute horizon', async () => {
    const publish = jest.fn();
    const deps = dependencies(publish, [ISSUED_AT + 2 * 60 * 1000 + 1]);
    const publisher = new NatsJetStreamPublisher(PUBLISHER_OPTIONS, deps.value);

    await expect(publisher.retryCommand(command())).rejects.toMatchObject({
      code: 'retry_window_elapsed',
    });
    expect(publish).not.toHaveBeenCalled();
  });

  it('rejects a PubAck from any stream other than commands V1', async () => {
    const publish = jest.fn(async () => ({
      stream: 'WRONG_STREAM',
      seq: 1,
      duplicate: false,
    }));
    const deps = dependencies(publish);
    const publisher = new NatsJetStreamPublisher(PUBLISHER_OPTIONS, deps.value);

    await expect(publisher.publishCommand(command())).rejects.toMatchObject({
      code: 'unexpected_stream',
    });
  });

  it('parses only explicit NATS backend credentials and keeps limits hardcoded', () => {
    const options = natsJetStreamPublisherOptionsFromEnvironment({
      NATS_URL: 'tls://nats-1:4222, tls://nats-2:4222',
      NATS_USER: 'underchat',
      NATS_PASSWORD: 'secret',
      NATS_TLS: 'true',
      NATS_CONNECTION_NAME: 'underchat-production',
    });
    expect(options).toMatchObject({
      servers: ['tls://nats-1:4222', 'tls://nats-2:4222'],
      user: 'underchat',
      password: 'secret',
      tls: true,
      connectionName: 'underchat-production',
    });
    expect(natsNodeConnectionOptions(options)).toMatchObject({
      servers: ['tls://nats-1:4222', 'tls://nats-2:4222'],
      user: 'underchat',
      pass: 'secret',
      tls: {},
      name: 'underchat-production',
    });
    expect(WORKER_COMMAND_STREAM_LIMITS).toEqual({
      maxAgeMs: 300_000,
      duplicateWindowMs: 300_000,
      maxBytes: 8 * 1024 * 1024 * 1024,
      maxMessages: 4_000_000,
      maxMessagesPerSubject: 10_000,
      replicas: 3,
      retention: 'workqueue',
    });
    expect(() =>
      natsJetStreamPublisherOptionsFromEnvironment({
        NATS_URL: 'nats://nats:4222',
        NATS_TOKEN: 'token',
        NATS_USER: 'user',
        NATS_PASSWORD: 'pass',
      })
    ).toThrow('suporta apenas autenticacao');
  });

  it('rejects token, JWT/NKey and missing static credentials', () => {
    expect(() =>
      natsJetStreamPublisherOptionsFromEnvironment({
        NATS_URL: 'nats://nats:4222',
        NATS_TOKEN: 'token',
      })
    ).toThrow('suporta apenas autenticacao');
    expect(() =>
      natsJetStreamPublisherOptionsFromEnvironment({
        NATS_URL: 'nats://nats:4222',
        NATS_CREDS_BASE64: 'legacy-creds',
      })
    ).toThrow('suporta apenas autenticacao');
    expect(() =>
      natsJetStreamPublisherOptionsFromEnvironment({
        NATS_URL: 'nats://nats:4222',
      })
    ).toThrow('NATS_USER e NATS_PASSWORD sao obrigatorias');
  });
});
