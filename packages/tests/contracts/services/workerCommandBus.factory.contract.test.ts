import { buildWorkerCommandEnvelopeV1 } from '@core/common/functions/workerCommandEnvelope';
import { NatsJetStreamPublisher } from '@core/services/natsJetStreamPublisher.service';
import {
  createWorkerCommandBus,
  resolveWorkerCommandTransport,
} from '@core/services/workerCommandBus.factory';

describe('WorkerCommandBus JetStream-only selection', () => {
  it('selects JetStream when configured or absent', () => {
    expect(resolveWorkerCommandTransport(undefined)).toBe('jetstream');
    expect(resolveWorkerCommandTransport(' jetstream ')).toBe('jetstream');
  });

  it.each(['kafka', 'legacy', 'dual', 'fallback'])(
    'fails closed for unsupported transport %s',
    (transport) => {
      expect(() => resolveWorkerCommandTransport(transport)).toThrow(
        'nao e suportado; use jetstream'
      );
    }
  );

  it('adapts publish, retry and close without a legacy fallback', async () => {
    const publisher = {
      publishCommand: jest.fn(async () => ({ duplicate: false })),
      retryCommand: jest.fn(async () => ({ duplicate: true })),
      close: jest.fn(async () => undefined),
    } as unknown as NatsJetStreamPublisher;
    const bus = createWorkerCommandBus({
      environment: { WORKER_COMMAND_TRANSPORT: 'jetstream' },
      publisher,
    });
    const envelope = buildWorkerCommandEnvelopeV1({
      command_id: 'command-1',
      operation_id: 'operation-1',
      retry_of: null,
      account_id: 'account-1',
      worker_id: 'worker-1',
      command_type: 'mark_read',
      entity_key: 'chat:chat-1',
      entity_sequence: 1,
      predecessor_operation_id: null,
      origin_epoch: 'epoch-1',
      issued_at: '2026-08-13T00:00:00.000Z',
      deadline_at: '2026-08-13T00:05:00.000Z',
      payload_version: 1,
      payload: { chat_id: 'chat-1' },
      traceparent: null,
      source: 'test',
    });

    await bus.publish(envelope);
    await bus.retry(envelope);
    await bus.close();

    expect(publisher.publishCommand).toHaveBeenCalledWith(envelope);
    expect(publisher.retryCommand).toHaveBeenCalledWith(envelope);
    expect(publisher.close).toHaveBeenCalledTimes(1);
  });
});
