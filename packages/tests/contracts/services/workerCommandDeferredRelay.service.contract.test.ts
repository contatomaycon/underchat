import 'reflect-metadata';
import {
  AckPolicy,
  DeliverPolicy,
  PubHeaders,
  ReplayPolicy,
  type JetStreamClient,
} from '@nats-io/jetstream';
import { nanos } from '@nats-io/nats-core';
import {
  WORKER_COMMAND_STREAM,
  WORKER_DEFERRED_STREAM,
} from '@core/common/constants/workerCommandTransport';
import { buildWorkerCommandEnvelopeV1 } from '@core/common/functions/workerCommandEnvelope';
import { workerCommandDeferredIdentity } from '@core/common/functions/workerCommandDeferred';
import { WorkerCommandDeferredRelayService } from '@core/services/workerCommandDeferredRelay.service';
import { WorkerCommandOperationalBarrierError } from '@core/services/workerCommandOperationalBarrier.service';

const NOW = Date.parse('2026-08-13T12:00:00.000Z');

function openBarrier() {
  return {
    runWithPermit: jest.fn(async (_scope: string, action: () => Promise<any>) =>
      action()
    ),
  };
}

function readyMessage(
  overrides: {
    ack?: () => Promise<boolean>;
    scheduler?: string;
    subject?: string;
  } = {}
) {
  const envelope = buildWorkerCommandEnvelopeV1({
    command_id: 'command-ready-1',
    operation_id: 'operation-ready-1',
    retry_of: null,
    account_id: 'account-1',
    worker_id: 'worker-1',
    command_type: 'direct_send',
    entity_key: 'chat:account-1:worker-1:5511999999999',
    entity_sequence: 4,
    predecessor_operation_id: 'operation-ready-0',
    origin_epoch: 'epoch-1',
    issued_at: new Date(NOW - 10_000).toISOString(),
    deadline_at: new Date(NOW + 290_000).toISOString(),
    payload_version: 1,
    payload: { text: 'ready' },
    traceparent: null,
    source: 'contract-test',
  });
  const data = new TextEncoder().encode(JSON.stringify(envelope));
  const identity = workerCommandDeferredIdentity(
    envelope.worker_id,
    envelope.command_id,
    77
  );
  const ackAck = jest.fn(overrides.ack ?? (async () => true));
  return {
    envelope,
    identity,
    data,
    ackAck,
    message: {
      subject: overrides.subject ?? 'uc.worker.deferred.ready.worker-1',
      seq: 42,
      data,
      string: () => new TextDecoder().decode(data),
      headers: {
        get: (name: string) =>
          name === PubHeaders.Scheduler
            ? (overrides.scheduler ?? identity.scheduleSubject)
            : '',
      },
      ackAck,
    },
  };
}

describe('WorkerCommandDeferredRelayService contract', () => {
  it('creates the canonical global durable and validates its full contract before consuming', async () => {
    let stopIterator: (() => void) | undefined;
    const stopped = new Promise<void>((resolve) => {
      stopIterator = resolve;
    });
    const messages = {
      close: jest.fn(async () => stopIterator?.()),
      async *[Symbol.asyncIterator]() {
        await stopped;
      },
    };
    const consumer = {
      info: jest.fn(async () => undefined),
      consume: jest.fn(async () => messages),
    };
    const add = jest.fn(async (_stream: string, config: object) => ({
      config,
    }));
    const manager = {
      consumers: {
        info: jest.fn(async () => {
          const error = new Error('missing');
          error.name = 'ConsumerNotFoundError';
          throw error;
        }),
        add,
      },
    };
    const client = { consumers: { get: jest.fn(async () => consumer) } };
    const connection = {
      isClosed: jest.fn(() => false),
      close: jest.fn(async () => undefined),
      drain: jest.fn(async () => undefined),
    };
    const failures = { publish: jest.fn(), close: jest.fn() };
    const relay = new WorkerCommandDeferredRelayService(
      {
        connect: jest.fn(async () => connection),
        jetstream: jest.fn(() => client),
        manager: jest.fn(async () => manager),
        now: () => NOW,
      } as never,
      failures as never,
      openBarrier() as never
    );

    await relay.execute();

    expect(add).toHaveBeenCalledWith(
      WORKER_DEFERRED_STREAM,
      expect.objectContaining({
        durable_name: 'uc_worker_deferred_relay_v1',
        name: 'uc_worker_deferred_relay_v1',
        filter_subject: 'uc.worker.deferred.ready.*',
        ack_policy: AckPolicy.Explicit,
        deliver_policy: DeliverPolicy.All,
        replay_policy: ReplayPolicy.Instant,
        ack_wait: nanos(30_000),
        max_deliver: -1,
        max_ack_pending: 512,
        max_batch: 128,
        max_waiting: 128,
        num_replicas: 3,
      })
    );
    expect(relay.health()).toMatchObject({ connected: true, running: true });
    await relay.close();
    expect(connection.drain).toHaveBeenCalledTimes(1);
  });

  it('fails closed and closes the startup connection on durable contract drift', async () => {
    const connection = {
      isClosed: jest.fn(() => false),
      close: jest.fn(async () => undefined),
      drain: jest.fn(async () => undefined),
    };
    const consumerGet = jest.fn();
    const relay = new WorkerCommandDeferredRelayService(
      {
        connect: jest.fn(async () => connection),
        jetstream: jest.fn(() => ({ consumers: { get: consumerGet } })),
        manager: jest.fn(async () => ({
          consumers: {
            info: jest.fn(async () => ({
              config: {
                durable_name: 'wrong_durable',
              },
            })),
          },
        })),
        now: () => NOW,
      } as never,
      { publish: jest.fn(), close: jest.fn() } as never,
      openBarrier() as never
    );

    await expect(relay.execute()).rejects.toThrow(
      'worker_command_deferred_relay_consumer_contract_drift'
    );
    expect(connection.close).toHaveBeenCalledTimes(1);
    expect(consumerGet).not.toHaveBeenCalled();
    expect(relay.health()).toMatchObject({ connected: false, running: false });
  });

  it('waits for the command PubAck before AckSync of the ready message', async () => {
    const events: string[] = [];
    const publish = jest.fn(async () => {
      events.push('command_puback');
      return { stream: WORKER_COMMAND_STREAM, seq: 88, duplicate: false };
    });
    const ready = readyMessage({
      ack: async () => {
        events.push('ready_acksync');
        return true;
      },
    });
    const relay = new WorkerCommandDeferredRelayService(
      {
        connect: jest.fn(),
        jetstream: jest.fn(),
        manager: jest.fn(),
        now: () => NOW,
      } as never,
      { publish: jest.fn(), close: jest.fn() } as never,
      openBarrier() as never
    );

    await relay.relayReadyMessage(
      ready.message as never,
      { publish } as unknown as JetStreamClient
    );

    expect(publish).toHaveBeenCalledWith(
      'uc.worker.command.worker-1',
      ready.data,
      {
        msgID: ready.identity.relayMessageId,
        expect: { streamName: WORKER_COMMAND_STREAM },
        timeout: 5_000,
        retries: 0,
      }
    );
    expect(events).toEqual(['command_puback', 'ready_acksync']);
  });

  it('keeps ready unacked if command publish fails', async () => {
    const ready = readyMessage();
    const relay = new WorkerCommandDeferredRelayService(
      {
        connect: jest.fn(),
        jetstream: jest.fn(),
        manager: jest.fn(),
        now: () => NOW,
      } as never,
      { publish: jest.fn(), close: jest.fn() } as never,
      openBarrier() as never
    );

    await expect(
      relay.relayReadyMessage(
        ready.message as never,
        {
          publish: jest.fn(async () => {
            throw new Error('nats unavailable');
          }),
        } as unknown as JetStreamClient
      )
    ).rejects.toThrow('nats unavailable');
    expect(ready.ackAck).not.toHaveBeenCalled();
  });

  it('publishes a bounded invalid event before AckSync on scheduler identity tampering', async () => {
    const ready = readyMessage({
      scheduler: 'uc.worker.deferred.schedule.worker-1.bad',
    });
    const failurePublish = jest.fn(async () => undefined);
    const relay = new WorkerCommandDeferredRelayService(
      {
        connect: jest.fn(),
        jetstream: jest.fn(),
        manager: jest.fn(),
        now: () => NOW,
      } as never,
      { publish: failurePublish, close: jest.fn() } as never,
      openBarrier() as never
    );
    const commandPublish = jest.fn();

    await relay.relayReadyMessage(
      ready.message as never,
      { publish: commandPublish } as unknown as JetStreamClient
    );

    expect(commandPublish).not.toHaveBeenCalled();
    expect(failurePublish).toHaveBeenCalledWith(
      expect.objectContaining({
        workerId: 'worker-1',
        code: 'invalid_envelope',
      })
    );
    expect(ready.ackAck).toHaveBeenCalledTimes(1);
  });

  it('never writes command bytes or an envelope into Redis', () => {
    const source = WorkerCommandDeferredRelayService.toString();
    expect(source).not.toMatch(/\.set\(|\.hset\(|\.eval\(/u);
    expect(WORKER_DEFERRED_STREAM).toBe('UC_WORKER_DEFERRED_V1');
  });

  it('does not start a deferred command publication while the barrier is paused', async () => {
    const ready = readyMessage();
    const barrier = openBarrier();
    barrier.runWithPermit.mockRejectedValueOnce(
      new WorkerCommandOperationalBarrierError(
        'paused',
        'worker_command_operational_barrier_paused'
      )
    );
    const relay = new WorkerCommandDeferredRelayService(
      {
        connect: jest.fn(),
        jetstream: jest.fn(),
        manager: jest.fn(),
        now: () => NOW,
      } as never,
      { publish: jest.fn(), close: jest.fn() } as never,
      barrier as never
    );
    const commandPublish = jest.fn();

    await expect(
      relay.relayReadyMessage(
        ready.message as never,
        { publish: commandPublish } as unknown as JetStreamClient
      )
    ).rejects.toThrow('worker_command_operational_barrier_paused');

    expect(commandPublish).not.toHaveBeenCalled();
    expect(ready.ackAck).not.toHaveBeenCalled();
  });
});
