import 'reflect-metadata';
import { createHash } from 'node:crypto';
import type { JetStreamClient, PubAck } from '@nats-io/jetstream';
import {
  WORKER_COMMAND_STREAM,
  WORKER_DEFERRED_STREAM,
} from '@core/common/constants/workerCommandTransport';
import { buildWorkerCommandEnvelopeV1 } from '@core/common/functions/workerCommandEnvelope';
import { workerCommandDeferredIdentity } from '@core/common/functions/workerCommandDeferred';
import type { WorkerCommandEnvelopeV1 } from '@core/common/interfaces/IWorkerCommandEnvelope';
import { WorkerCommandDeferredParkerService } from '@core/services/workerCommandDeferredParker.service';
import { WorkerCommandPredecessorPendingError } from '@core/services/workerCommandLane.service';
import { workerCommandPredecessorWaitAction } from '@core/services/workerCommandJetStreamIngress.service';

const NOW = Date.parse('2026-08-13T12:00:00.000Z');

function envelope(): WorkerCommandEnvelopeV1 {
  return buildWorkerCommandEnvelopeV1({
    command_id: 'command-deferred-1',
    operation_id: 'operation-deferred-1',
    retry_of: null,
    account_id: 'account-1',
    worker_id: 'worker-1',
    command_type: 'direct_send',
    entity_key: 'chat:account-1:worker-1:5511999999999',
    entity_sequence: 3,
    predecessor_operation_id: 'operation-deferred-0',
    origin_epoch: 'epoch-1',
    issued_at: new Date(NOW - 5_000).toISOString(),
    deadline_at: new Date(NOW + 295_000).toISOString(),
    payload_version: 1,
    payload: { text: 'oi' },
    traceparent: null,
    source: 'contract-test',
  });
}

describe('WorkerCommandDeferredParkerService contract', () => {
  it('uses the canonical schedule identity and PubAcks it before AckSync of the original', async () => {
    const events: string[] = [];
    const publish = jest.fn(async (): Promise<PubAck> => {
      events.push('schedule_puback');
      return { stream: WORKER_DEFERRED_STREAM, seq: 91, duplicate: false };
    });
    const ackAck = jest.fn(async () => {
      events.push('original_acksync');
      return true;
    });
    const command = envelope();
    const data = new TextEncoder().encode(JSON.stringify(command));
    const parker = new WorkerCommandDeferredParkerService(() => NOW);

    await expect(
      parker.parkAndAckOriginal(
        { publish } as unknown as JetStreamClient,
        { seq: 77, data, ackAck },
        command
      )
    ).resolves.toMatchObject({
      stream: WORKER_DEFERRED_STREAM,
      streamSequence: 91,
      duplicate: false,
      readySubject: 'uc.worker.deferred.ready.worker-1',
      scheduledAt: '2026-08-13T12:00:01.000Z',
      expiresAt: command.deadline_at,
    });

    const scheduleId = createHash('sha256')
      .update('command-deferred-1:77')
      .digest('hex');
    expect(publish).toHaveBeenCalledWith(
      `uc.worker.deferred.schedule.worker-1.${scheduleId}`,
      data,
      expect.objectContaining({
        msgID: `worker-deferred-schedule-v1:${scheduleId}`,
        expect: { streamName: WORKER_DEFERRED_STREAM },
        retries: 0,
        schedule: {
          specification: { at: new Date(NOW + 1_000) },
          target: 'uc.worker.deferred.ready.worker-1',
          ttl: '294000ms',
        },
      })
    );
    expect(events).toEqual(['schedule_puback', 'original_acksync']);
  });

  it('does not AckSync the original when the schedule PubAck is invalid', async () => {
    const publish = jest.fn(async () => ({
      stream: WORKER_COMMAND_STREAM,
      seq: 1,
      duplicate: false,
    }));
    const ackAck = jest.fn(async () => true);
    const command = envelope();

    await expect(
      new WorkerCommandDeferredParkerService(() => NOW).parkAndAckOriginal(
        { publish } as unknown as JetStreamClient,
        {
          seq: 1,
          data: new TextEncoder().encode(JSON.stringify(command)),
          ackAck,
        },
        command
      )
    ).rejects.toThrow('worker_command_deferred_unexpected_stream');
    expect(ackAck).not.toHaveBeenCalled();
  });

  it('parks only never-active predecessor waits and keeps one ever-active successor pending', () => {
    expect(
      workerCommandPredecessorWaitAction(
        new WorkerCommandPredecessorPendingError('predecessor_never_active')
      )
    ).toBe('park');
    expect(
      workerCommandPredecessorWaitAction(
        new WorkerCommandPredecessorPendingError('predecessor_ever_active')
      )
    ).toBe('wait');
    expect(
      workerCommandPredecessorWaitAction(
        new WorkerCommandPredecessorPendingError('predecessor_identity_missing')
      )
    ).toBe('park');
    expect(
      workerCommandPredecessorWaitAction(
        new WorkerCommandPredecessorPendingError(
          'predecessor_dependency_pending'
        )
      )
    ).toBe('park');
  });

  it('derives stable but distinct schedule and relay message IDs', () => {
    const identity = workerCommandDeferredIdentity(
      'worker-1',
      'command-deferred-1',
      77
    );
    expect(identity.scheduleMessageId).not.toBe(identity.relayMessageId);
    expect(identity).toEqual(
      workerCommandDeferredIdentity('worker-1', 'command-deferred-1', 77)
    );
  });
});
