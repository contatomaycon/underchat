import 'reflect-metadata';

const publish = jest.fn();
const retry = jest.fn();
const close = jest.fn(async () => undefined);

jest.mock('@core/services/workerCommandBus.factory', () => ({
  createWorkerCommandBus: () => ({ publish, retry, close }),
}));

import { WorkerCommandAdmissionService } from '@core/services/workerCommandAdmission.service';

function setup() {
  const events: string[] = [];
  const lane = {
    allocate: jest.fn(async () => ({
      existing: false,
      commandId: 'command-1',
      entitySequence: 1,
      predecessorOperationId: null,
      issuedAt: new Date('2026-08-13T12:00:00.000Z'),
      originEpoch: 'epoch-1',
    })),
  };
  const epochs = {
    requireActive: jest.fn(async () => ({ record: { epoch: 'epoch-1' } })),
    assertActive: jest.fn(async () => {
      events.push('epoch_assert');
    }),
    close: jest.fn(async () => undefined),
  };
  const deadlines = {
    reserveAdmissionIdentity: jest.fn(async (input: any) => ({
      existing: false,
      issuedAt: input.proposedIssuedAt,
      commandId: input.proposedCommandId,
      originEpoch: input.originEpoch,
      observedAtMs: input.proposedIssuedAt.getTime(),
    })),
    register: jest.fn(async () => {
      events.push('deadline_register');
    }),
  };
  const barrier = {
    runWithPermit: jest.fn(async (_scope: string, action: () => Promise<any>) =>
      action()
    ),
  };
  publish.mockImplementationOnce(async () => {
    events.push('publish');
    return {
      command_id: 'command-1',
      operation_id: 'operation-1',
      stream: 'UC_WORKER_COMMANDS_V1',
      stream_sequence: 1,
      duplicate: false,
      accepted_at: '2026-08-13T12:00:00.100Z',
      expires_at: '2026-08-13T12:05:00.000Z',
    };
  });
  return {
    events,
    lane,
    epochs,
    deadlines,
    barrier,
    service: new WorkerCommandAdmissionService(
      lane as never,
      epochs as never,
      deadlines as never,
      barrier as never
    ),
  };
}

describe('WorkerCommandAdmissionService deadline durability contract', () => {
  beforeEach(() => {
    publish.mockReset();
    retry.mockReset();
    close.mockClear();
  });

  it('registers compact deadline evidence before epoch revalidation and publish', async () => {
    const { service, events, deadlines } = setup();

    await service.admit({
      accountId: 'account-1',
      workerId: 'worker-1',
      commandType: 'webhook_integration',
      entityKey: 'webhook:integration-1',
      operationId: 'operation-1',
      payload: { secret: 'payload-remains-outside-deadline-index' },
      source: 'deadline-contract-test',
      issuedAt: '2026-08-13T12:00:00.000Z',
    });

    expect(events).toEqual(['deadline_register', 'epoch_assert', 'publish']);
    expect(deadlines.register).toHaveBeenCalledWith(
      expect.objectContaining({
        command_id: 'command-1',
        operation_id: 'operation-1',
        deadline_at: '2026-08-13T12:05:00.000Z',
      }),
      undefined
    );
  });

  it('does not publish when durable deadline registration fails', async () => {
    const { service, deadlines, epochs } = setup();
    deadlines.register.mockRejectedValueOnce(new Error('redis_unavailable'));

    await expect(
      service.admit({
        accountId: 'account-1',
        workerId: 'worker-1',
        commandType: 'mark_read',
        entityKey: 'chat:1',
        operationId: 'operation-1',
        payload: { message_id: 'message-1' },
        source: 'deadline-contract-test',
        issuedAt: '2026-08-13T12:00:00.000Z',
      })
    ).rejects.toThrow('redis_unavailable');

    expect(epochs.assertActive).not.toHaveBeenCalled();
    expect(publish).not.toHaveBeenCalled();
  });

  it('does not recreate the two-minute public retry window after lane expiry', async () => {
    const { service, deadlines, lane } = setup();
    const issuedAt = new Date('2026-08-13T12:00:00.000Z');
    deadlines.reserveAdmissionIdentity.mockResolvedValueOnce({
      existing: true,
      issuedAt,
      commandId: 'command-original',
      originEpoch: 'epoch-1',
      observedAtMs: issuedAt.getTime() + 2 * 60 * 1000,
    });

    await expect(
      service.admit({
        accountId: 'account-1',
        workerId: 'worker-1',
        commandType: 'mark_read',
        entityKey: 'chat:1',
        operationId: 'operation-1',
        payload: { message_id: 'message-1' },
        source: 'deadline-contract-test',
        retry: true,
      })
    ).rejects.toMatchObject({
      code: 'retry_window_elapsed',
      operationId: 'operation-1',
      commandId: 'command-original',
      issuedAt: issuedAt.toISOString(),
    });

    expect(lane.allocate).not.toHaveBeenCalled();
    expect(publish).not.toHaveBeenCalled();
    expect(retry).not.toHaveBeenCalled();
  });

  it('fails closed when the immutable operation identity cannot be reserved', async () => {
    const { service, deadlines, lane } = setup();
    deadlines.reserveAdmissionIdentity.mockRejectedValueOnce(
      new Error('worker_command_admission_identity_capacity_exhausted')
    );

    await expect(
      service.admit({
        accountId: 'account-1',
        workerId: 'worker-1',
        commandType: 'notification_send',
        entityKey: 'chat:1',
        operationId: 'operation-1',
        payload: { message_id: 'message-1' },
        source: 'deadline-contract-test',
      })
    ).rejects.toThrow('worker_command_admission_identity_capacity_exhausted');

    expect(lane.allocate).not.toHaveBeenCalled();
    expect(publish).not.toHaveBeenCalled();
    expect(retry).not.toHaveBeenCalled();
  });

  it('rejects self-referential retry ancestry before touching Redis or a lane', async () => {
    const { service, deadlines, lane } = setup();

    await expect(
      service.admit({
        accountId: 'account-1',
        workerId: 'worker-1',
        commandType: 'direct_send',
        entityKey: 'chat:1',
        operationId: 'operation-1',
        retryOf: 'operation-1',
        payload: { message_id: 'message-1' },
        source: 'deadline-contract-test',
      })
    ).rejects.toThrow('worker_command_retry_of_invalid');

    expect(deadlines.reserveAdmissionIdentity).not.toHaveBeenCalled();
    expect(lane.allocate).not.toHaveBeenCalled();
    expect(publish).not.toHaveBeenCalled();
    expect(retry).not.toHaveBeenCalled();
  });

  it('checks the global barrier before epoch, identity, lane or publish', async () => {
    const { service, barrier, epochs, deadlines, lane } = setup();
    barrier.runWithPermit.mockRejectedValueOnce(
      new Error('worker_command_operational_barrier_paused')
    );

    await expect(
      service.admit({
        accountId: 'account-1',
        workerId: 'worker-1',
        commandType: 'direct_send',
        entityKey: 'chat:1',
        operationId: 'operation-1',
        payload: { message_id: 'message-1' },
        source: 'deadline-contract-test',
      })
    ).rejects.toThrow('worker_command_operational_barrier_paused');

    expect(barrier.runWithPermit).toHaveBeenCalledWith(
      'admission',
      expect.any(Function)
    );
    expect(epochs.requireActive).not.toHaveBeenCalled();
    expect(deadlines.reserveAdmissionIdentity).not.toHaveBeenCalled();
    expect(lane.allocate).not.toHaveBeenCalled();
    expect(publish).not.toHaveBeenCalled();
  });
});
