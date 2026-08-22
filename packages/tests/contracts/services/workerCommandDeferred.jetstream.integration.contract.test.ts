import 'reflect-metadata';
import {
  AckPolicy,
  DeliverPolicy,
  ReplayPolicy,
  jetstream,
  jetstreamManager,
} from '@nats-io/jetstream';
import { nanos } from '@nats-io/nats-core';
import { connect } from '@nats-io/transport-node';
import {
  WORKER_COMMAND_STREAM,
  WORKER_DEFERRED_STREAM,
} from '@core/common/constants/workerCommandTransport';
import { buildWorkerCommandEnvelopeV1 } from '@core/common/functions/workerCommandEnvelope';
import { workerCommandDeferredIdentity } from '@core/common/functions/workerCommandDeferred';
import { WorkerCommandDeferredParkerService } from '@core/services/workerCommandDeferredParker.service';
import { WorkerCommandDeferredRelayService } from '@core/services/workerCommandDeferredRelay.service';
import { natsNodeConnectionOptions } from '@core/services/natsJetStreamPublisher.service';

const natsUrl = process.env.TEST_NATS_URL?.trim();
const integrationTest = natsUrl ? it : it.skip;

describe('worker-command deferred JetStream integration', () => {
  integrationTest(
    'schedules bytes, AckSyncs the original, relays ready and AckSyncs only after command PubAck',
    async () => {
      if (!natsUrl) throw new Error('TEST_NATS_URL is required');
      const suffix = `${Date.now()}-${Math.floor(Math.random() * 1_000_000)}`;
      const workerId = `itest-${suffix}`;
      const commandDurable = `itest_command_${suffix}`.replaceAll('-', '_');
      const readyDurable = `itest_ready_${suffix}`.replaceAll('-', '_');
      const connection = await connect(
        natsNodeConnectionOptions({
          servers: [natsUrl],
          user: process.env.TEST_NATS_USER ?? '',
          password: process.env.TEST_NATS_PASSWORD ?? '',
          connectionName: `deferred-itest-${suffix}`,
        })
      );
      const js = jetstream(connection, { timeout: 5_000 });
      const manager = await jetstreamManager(connection, { timeout: 5_000 });
      try {
        await manager.consumers.add(WORKER_COMMAND_STREAM, {
          durable_name: commandDurable,
          name: commandDurable,
          ack_policy: AckPolicy.Explicit,
          deliver_policy: DeliverPolicy.All,
          replay_policy: ReplayPolicy.Instant,
          ack_wait: nanos(30_000),
          max_ack_pending: 8,
          filter_subject: `uc.worker.command.${workerId}`,
          num_replicas: 3,
        });
        await manager.consumers.add(WORKER_DEFERRED_STREAM, {
          durable_name: readyDurable,
          name: readyDurable,
          ack_policy: AckPolicy.Explicit,
          deliver_policy: DeliverPolicy.All,
          replay_policy: ReplayPolicy.Instant,
          ack_wait: nanos(30_000),
          max_ack_pending: 8,
          filter_subject: `uc.worker.deferred.ready.${workerId}`,
          num_replicas: 3,
        });
        const commandConsumer = await js.consumers.get(
          WORKER_COMMAND_STREAM,
          commandDurable
        );
        const readyConsumer = await js.consumers.get(
          WORKER_DEFERRED_STREAM,
          readyDurable
        );
        const original = buildWorkerCommandEnvelopeV1({
          command_id: `command-${suffix}`,
          operation_id: `operation-${suffix}`,
          retry_of: null,
          account_id: 'account-itest',
          worker_id: workerId,
          command_type: 'direct_send',
          entity_key: `chat:account-itest:${workerId}:5511999999999`,
          entity_sequence: 2,
          predecessor_operation_id: `predecessor-${suffix}`,
          origin_epoch: 'epoch-itest',
          issued_at: new Date().toISOString(),
          deadline_at: new Date(Date.now() + 4 * 60 * 1000).toISOString(),
          payload_version: 1,
          payload: { text: 'integration' },
          traceparent: null,
          source: 'deferred-integration-test',
        });
        await js.publish(
          `uc.worker.command.${workerId}`,
          new TextEncoder().encode(JSON.stringify(original)),
          {
            msgID: original.command_id,
            expect: { streamName: WORKER_COMMAND_STREAM },
          }
        );
        const originalMessage = await commandConsumer.next({ expires: 5_000 });
        expect(originalMessage).toBeDefined();
        if (!originalMessage) throw new Error('Original command not delivered');
        await new WorkerCommandDeferredParkerService().parkAndAckOriginal(
          js,
          originalMessage,
          original
        );

        const readyMessage = await readyConsumer.next({ expires: 10_000 });
        expect(readyMessage).toBeDefined();
        if (!readyMessage) throw new Error('Deferred command not delivered');
        const identity = workerCommandDeferredIdentity(
          workerId,
          original.command_id,
          originalMessage.seq
        );
        expect(readyMessage.headers?.get('Nats-Scheduler')).toBe(
          identity.scheduleSubject
        );

        const relay = new WorkerCommandDeferredRelayService(
          {
            connect: jest.fn(),
            jetstream: jest.fn(),
            manager: jest.fn(),
            now: Date.now,
          } as never,
          { publish: jest.fn(), close: jest.fn() } as never,
          {
            runWithPermit: jest.fn(
              async (_scope: string, action: () => Promise<unknown>) => action()
            ),
          } as never
        );
        await relay.relayReadyMessage(readyMessage, js);

        const relayed = await commandConsumer.next({ expires: 5_000 });
        expect(relayed).toBeDefined();
        if (!relayed) throw new Error('Relayed command not delivered');
        expect(JSON.parse(relayed.string())).toMatchObject({
          command_id: original.command_id,
          operation_id: original.operation_id,
        });
        relayed.ack();
      } finally {
        await manager.consumers
          .delete(WORKER_COMMAND_STREAM, commandDurable)
          .catch(() => undefined);
        await manager.consumers
          .delete(WORKER_DEFERRED_STREAM, readyDurable)
          .catch(() => undefined);
        await connection.drain();
      }
    },
    30_000
  );
});
