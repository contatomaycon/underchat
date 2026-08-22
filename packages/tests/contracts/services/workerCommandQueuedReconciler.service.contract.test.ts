import 'reflect-metadata';
import { WorkerCommandQueuedReconcilerService } from '@core/services/workerCommandQueuedReconciler.service';
import type { IChatMessage } from '@core/common/interfaces/IChatMessage';
import { WorkerCommandOperationalBarrierError } from '@core/services/workerCommandOperationalBarrier.service';

function message(issuedAt: string): IChatMessage {
  return {
    message_id: 'message-1',
    chat_id: 'chat-1',
    message_key: {
      remote_jid: '5511999999999@s.whatsapp.net',
      is_view_once: false,
    },
    type_user: 'operator' as never,
    account: { id: 'account-1', name: 'Account' },
    worker: { id: 'worker-1', name: 'Worker' },
    phone: '5511999999999',
    content: { type: 'text' as never, message: 'hello' },
    summary: {
      is_sent: false,
      is_delivered: false,
      is_seen: false,
      is_sent_to_internal: true,
    },
    date: issuedAt,
    sent_from_platform: true,
    delivery_status: 'queued',
    worker_command_transport: 'jetstream',
    worker_command_issued_at: issuedAt,
    worker_command_deadline_at: new Date(
      Date.parse(issuedAt) + 5 * 60_000
    ).toISOString(),
  };
}

function setup(source: IChatMessage) {
  const elastic = {
    indices: jest.fn(async () => true),
    selectOrThrow: jest.fn(async (_index: string, query: any) => {
      const filters = query?.query?.bool?.filter ?? [];
      const deadlineRange = filters.find(
        (item: any) => item?.range?.worker_command_deadline_at
      )?.range?.worker_command_deadline_at;
      const issuedRange = filters.find(
        (item: any) => item?.range?.worker_command_issued_at
      )?.range?.worker_command_issued_at;
      const invalidClock = filters.some(
        (item: any) => item?.bool?.minimum_should_match === 1
      );
      const deadline = Date.parse(source.worker_command_deadline_at ?? '');
      const issued = Date.parse(source.worker_command_issued_at ?? '');
      const matches = deadlineRange
        ? Number.isFinite(deadline) &&
          deadline <= Date.parse(String(deadlineRange.lte))
        : issuedRange
          ? Number.isFinite(issued) &&
            issued > Date.parse(String(issuedRange.gt)) &&
            issued <= Date.parse(String(issuedRange.lte))
          : invalidClock
            ? !source.worker_command_issued_at ||
              !source.worker_command_deadline_at
            : false;
      return {
        hits: {
          hits: matches ? [{ _id: source.message_id, _source: source }] : [],
        },
      };
    }),
  };
  const chats = {
    markWorkerCommandAccepted: jest.fn(async () => undefined),
    markWorkerCommandExpired: jest.fn(async () => undefined),
    markInvalidWorkerCommandExpired: jest.fn(async () => undefined),
  };
  const admission = {
    admit: jest.fn(async () => ({
      receipt: {
        command_id: 'command-1',
        operation_id: source.message_id,
        stream: 'UC_WORKER_COMMANDS_V1',
        stream_sequence: 1,
        duplicate: true,
        accepted_at: '2026-08-13T12:01:00.000Z',
        expires_at: source.worker_command_deadline_at,
      },
    })),
  };
  const lanes = {
    expireNeverActive: jest.fn(async (): Promise<string> => 'expired'),
  };
  const barrier = {
    runWithPermit: jest.fn(
      async (_scope: string, action: () => Promise<void>) => action()
    ),
  };
  return {
    elastic,
    chats,
    admission,
    lanes,
    barrier,
    service: new WorkerCommandQueuedReconcilerService(
      elastic as never,
      chats as never,
      admission as never,
      lanes as never,
      barrier as never
    ),
  };
}

describe('WorkerCommandQueuedReconcilerService', () => {
  it('keeps reconciliation read-only instead of mutating mappings from the readiness loop', async () => {
    const source = message('2026-08-13T12:00:00.000Z');
    const { elastic, service } = setup(source);

    await service.runOnce(new Date('2026-08-13T11:00:00.000Z'));
    await service.runOnce(new Date('2026-08-13T11:01:00.000Z'));

    expect(elastic.indices).not.toHaveBeenCalled();
    expect(elastic.selectOrThrow).toHaveBeenCalled();
  });

  it('tolerates legacy indices where the worker-command date fields are not mapped yet', async () => {
    const source = message('2026-08-13T12:00:00.000Z');
    const { elastic, service } = setup(source);

    await service.runOnce(new Date('2026-08-13T11:00:00.000Z'));

    const expirationQuery = elastic.selectOrThrow.mock.calls[0]?.[1] as {
      sort?: Array<Record<string, { order?: string; unmapped_type?: string }>>;
    };
    const retryQuery = elastic.selectOrThrow.mock.calls[1]?.[1] as {
      sort?: Array<Record<string, { order?: string; unmapped_type?: string }>>;
    };
    const invalidQuery = elastic.selectOrThrow.mock.calls[2]?.[1] as {
      sort?: Array<Record<string, { order?: string; unmapped_type?: string }>>;
    };

    expect(expirationQuery.sort?.[0]).toEqual({
      worker_command_deadline_at: {
        order: 'asc',
        unmapped_type: 'date',
      },
    });
    expect(retryQuery.sort?.[0]).toEqual({
      worker_command_issued_at: {
        order: 'asc',
        unmapped_type: 'date',
      },
    });
    expect(invalidQuery.sort?.[0]).toEqual({
      message_id: { order: 'asc' },
    });
  });

  it('retries the immutable operation only inside the two-minute window', async () => {
    const source = message('2026-08-13T12:00:00.000Z');
    source.broker_command_id = 'projection-only';
    source.broker_accepted_at = null;
    const { admission, chats, service } = setup(source);

    await service.runOnce(new Date('2026-08-13T12:01:59.999Z'));

    expect(admission.admit).toHaveBeenCalledWith(
      expect.objectContaining({
        accountId: 'account-1',
        workerId: 'worker-1',
        operationId: 'message-1',
        retry: true,
        issuedAt: new Date('2026-08-13T12:00:00.000Z'),
        source: 'queued_message_reconciler',
        payload: expect.not.objectContaining({
          broker_command_id: expect.anything(),
        }),
      })
    );
    expect(chats.markWorkerCommandAccepted).toHaveBeenCalledTimes(1);
    expect(service.getStatus()).toMatchObject({
      scanned_total: 1,
      republished_total: 1,
      expired_total: 0,
    });
  });

  it('does not republish from two minutes through the five-minute deadline', async () => {
    const source = message('2026-08-13T12:00:00.000Z');
    const { admission, chats, service } = setup(source);

    await service.runOnce(new Date('2026-08-13T12:02:00.000Z'));

    expect(admission.admit).not.toHaveBeenCalled();
    expect(chats.markWorkerCommandExpired).not.toHaveBeenCalled();
  });

  it('expires at the inclusive five-minute boundary and never publishes', async () => {
    const source = message('2026-08-13T12:00:00.000Z');
    const { admission, chats, service } = setup(source);

    await service.runOnce(new Date('2026-08-13T12:05:00.000Z'));

    expect(admission.admit).not.toHaveBeenCalled();
    expect(chats.markWorkerCommandExpired).toHaveBeenCalledWith(
      'account-1',
      'message-1',
      '2026-08-13T12:05:00.000Z',
      '2026-08-13T12:05:00.000Z'
    );
    expect(service.getStatus().expired_total).toBe(1);
  });

  it('expires a PubAcked command that never acquired its execution lane', async () => {
    const source = message('2026-08-13T12:00:00.000Z');
    source.broker_command_id = 'command-accepted';
    source.broker_accepted_at = '2026-08-13T12:00:01.000Z';
    const { elastic, admission, chats, lanes, service } = setup(source);

    await service.runOnce(new Date('2026-08-13T12:05:00.000Z'));

    const expirationQuery = elastic.selectOrThrow.mock.calls[0]?.[1] as {
      query?: { bool?: { must_not?: unknown[] } };
    };
    expect(expirationQuery.query?.bool?.must_not).toBeUndefined();
    expect(lanes.expireNeverActive).toHaveBeenCalledTimes(1);
    expect(admission.admit).not.toHaveBeenCalled();
    expect(chats.markWorkerCommandExpired).toHaveBeenCalledTimes(1);
  });

  it('never expires an operation that already crossed the execution lane', async () => {
    const source = message('2026-08-13T12:00:00.000Z');
    const { admission, chats, lanes, service } = setup(source);
    lanes.expireNeverActive.mockResolvedValueOnce('ever_active');

    await service.runOnce(new Date('2026-08-13T12:05:00.000Z'));

    expect(admission.admit).not.toHaveBeenCalled();
    expect(chats.markWorkerCommandExpired).not.toHaveBeenCalled();
    expect(service.getStatus().expired_total).toBe(0);
  });

  it('does not project expiry while a transitive predecessor remains pending', async () => {
    const source = message('2026-08-13T12:00:00.000Z');
    const { chats, lanes, service } = setup(source);
    lanes.expireNeverActive.mockResolvedValueOnce('predecessor_pending');

    await service.runOnce(new Date('2026-08-13T12:05:00.000Z'));

    expect(chats.markWorkerCommandExpired).not.toHaveBeenCalled();
    expect(service.getStatus().expired_total).toBe(0);
  });

  it('projects an expiry already terminalized by the generic deadline reconciler', async () => {
    const source = message('2026-08-13T12:00:00.000Z');
    const { chats, lanes, service } = setup(source);
    lanes.expireNeverActive.mockResolvedValueOnce('terminal:expired');

    await service.runOnce(new Date('2026-08-13T12:05:00.000Z'));

    expect(chats.markWorkerCommandExpired).toHaveBeenCalledTimes(1);
    expect(service.getStatus().expired_total).toBe(1);
  });

  it('quarantines malformed clocks without inventing a new issued_at', async () => {
    const source = message('2026-08-13T12:00:00.000Z');
    source.worker_command_issued_at = null;
    const { admission, chats, service } = setup(source);

    await service.runOnce(new Date('2026-08-13T12:01:00.000Z'));

    expect(admission.admit).not.toHaveBeenCalled();
    expect(chats.markWorkerCommandExpired).not.toHaveBeenCalled();
    expect(chats.markInvalidWorkerCommandExpired).toHaveBeenCalledWith(
      'account-1',
      'message-1',
      '2026-08-13T12:01:00.000Z'
    );
    expect(service.getStatus()).toMatchObject({
      failed_total: 0,
      expired_total: 1,
    });
  });

  it('skips the whole bounded job while the global barrier is paused', async () => {
    const source = message('2026-08-13T12:00:00.000Z');
    const { elastic, admission, barrier, service } = setup(source);
    barrier.runWithPermit.mockRejectedValueOnce(
      new WorkerCommandOperationalBarrierError(
        'paused',
        'worker_command_operational_barrier_paused'
      )
    );

    await expect(
      service.runOnce(new Date('2026-08-13T12:01:00.000Z'))
    ).resolves.toBeUndefined();

    expect(elastic.selectOrThrow).not.toHaveBeenCalled();
    expect(admission.admit).not.toHaveBeenCalled();
    expect(service.getStatus()).toMatchObject({
      barrier_paused: true,
      barrier_skipped_total: 1,
    });
  });
});
