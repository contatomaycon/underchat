import 'reflect-metadata';
import {
  WorkerCommandEpochError,
  WorkerCommandEpochService,
  type WorkerCommandEpochRecordV1,
  type WorkerCommandEpochSnapshot,
} from '@core/services/workerCommandEpoch.service';

interface EpochHarness {
  get: jest.Mock<Promise<WorkerCommandEpochSnapshot | null>, [string]>;
  write: jest.Mock<
    Promise<WorkerCommandEpochSnapshot>,
    [WorkerCommandEpochRecordV1, number | null]
  >;
}

interface EpochDecoder {
  decode(entry: {
    key: string;
    value: Uint8Array;
    revision: number;
  }): WorkerCommandEpochSnapshot;
}

const accountId = 'account-1';
const workerId = 'worker-1';
const writerEpochA = '019c0000-0000-7000-8000-000000000001';
const writerEpochB = '019c0000-0000-7000-8000-000000000002';

function serviceHarness(initial: WorkerCommandEpochSnapshot | null = null): {
  service: WorkerCommandEpochService;
  harness: EpochHarness;
  snapshot: () => WorkerCommandEpochSnapshot | null;
} {
  const service = Object.create(
    WorkerCommandEpochService.prototype
  ) as WorkerCommandEpochService;
  let current = initial;
  let nextRevision = initial?.revision ?? 0;
  const harness = service as unknown as EpochHarness;
  harness.get = jest.fn(async (_workerId: string) => current);
  harness.write = jest.fn(async (record, expectedRevision) => {
    if (expectedRevision !== (current?.revision ?? null)) {
      throw new WorkerCommandEpochError(
        'conflict',
        `worker_command_epoch_cas_failed:${record.worker_id}`
      );
    }
    current = { record, revision: ++nextRevision };
    return current;
  });
  return { service, harness, snapshot: () => current };
}

function activeRecord(
  overrides: Partial<WorkerCommandEpochRecordV1> = {}
): WorkerCommandEpochRecordV1 {
  return {
    schema_version: 1,
    worker_id: workerId,
    account_id: accountId,
    epoch: '019c0000-0000-7000-8000-000000000010',
    runtime_writer_epoch: writerEpochA,
    runtime_generation: 1,
    state: 'active',
    activated_at: '2026-08-13T12:00:00.000Z',
    updated_at: '2026-08-13T12:00:00.000Z',
    closed_at: null,
    ...overrides,
  };
}

function decodeRecord(
  record: WorkerCommandEpochRecordV1,
  key = `worker.${workerId}`
): WorkerCommandEpochSnapshot {
  const decoder = Object.create(
    WorkerCommandEpochService.prototype
  ) as EpochDecoder;
  return decoder.decode({
    key,
    value: Buffer.from(JSON.stringify(record)),
    revision: 3,
  });
}

describe('WorkerCommandEpochService logical command epoch', () => {
  it('enforces the canonical KV record shared with the Go runtime', () => {
    expect(decodeRecord(activeRecord())).toEqual({
      record: activeRecord(),
      revision: 3,
    });
    expect(() => decodeRecord(activeRecord(), 'worker.worker-2')).toThrow(
      'worker_command_epoch_record_invalid'
    );
    expect(() =>
      decodeRecord(activeRecord({ updated_at: '2026-08-13T12:00:00Z' }))
    ).toThrow('worker_command_epoch_record_invalid');
    expect(() =>
      decodeRecord(
        activeRecord({
          state: 'closed',
          closed_at: null,
        })
      )
    ).toThrow('worker_command_epoch_record_invalid');
    expect(() =>
      decodeRecord(activeRecord({ runtime_writer_epoch: 'writer\u0007epoch' }))
    ).toThrow('worker_command_epoch_record_invalid');
  });

  it('creates one logical epoch and keeps a same-runtime restart idempotent', async () => {
    const { service, harness } = serviceHarness();
    const now = new Date('2026-08-13T12:00:00.000Z');

    const created = await service.activateRuntime({
      accountId,
      workerId,
      runtimeWriterEpoch: writerEpochA,
      runtimeGeneration: 1,
      now,
    });

    expect(created.record).toMatchObject({
      worker_id: workerId,
      account_id: accountId,
      runtime_writer_epoch: writerEpochA,
      runtime_generation: 1,
      state: 'active',
    });
    expect(created.record.epoch).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u
    );
    expect(created.record.epoch).not.toBe(writerEpochA);

    await expect(
      service.activateRuntime({
        accountId,
        workerId,
        runtimeWriterEpoch: writerEpochA,
        runtimeGeneration: 1,
        now: new Date('2026-08-13T12:00:01.000Z'),
      })
    ).resolves.toBe(created);
    expect(harness.write).toHaveBeenCalledTimes(1);
  });

  it('preserves the command epoch across recreate so accepted backlog stays authorized', async () => {
    const { service } = serviceHarness();
    const first = await service.activateRuntime({
      accountId,
      workerId,
      runtimeWriterEpoch: writerEpochA,
      runtimeGeneration: 1,
      now: new Date('2026-08-13T12:00:00.000Z'),
    });
    const acceptedBacklogOriginEpoch = first.record.epoch;

    const recreated = await service.activateRuntime({
      accountId,
      workerId,
      runtimeWriterEpoch: writerEpochB,
      runtimeGeneration: 2,
      now: new Date('2026-08-13T12:01:00.000Z'),
    });

    expect(recreated.record).toMatchObject({
      epoch: acceptedBacklogOriginEpoch,
      runtime_writer_epoch: writerEpochB,
      runtime_generation: 2,
      activated_at: first.record.activated_at,
    });
    await expect(
      service.assertRuntimeActive(
        accountId,
        workerId,
        acceptedBacklogOriginEpoch,
        2,
        writerEpochB
      )
    ).resolves.toBe(recreated);
    await expect(
      service.assertRuntimeActive(
        accountId,
        workerId,
        acceptedBacklogOriginEpoch,
        1,
        writerEpochA
      )
    ).rejects.toThrow('worker_command_epoch_runtime_replaced');
  });

  it('rejects a competing runtime in the same generation and stale generations', async () => {
    const { service } = serviceHarness({
      record: activeRecord(),
      revision: 7,
    });

    await expect(
      service.activateRuntime({
        accountId,
        workerId,
        runtimeWriterEpoch: writerEpochB,
        runtimeGeneration: 1,
      })
    ).rejects.toThrow('worker_command_epoch_runtime_identity_conflict');
    await expect(
      service.activateRuntime({
        accountId,
        workerId,
        runtimeWriterEpoch: writerEpochB,
        runtimeGeneration: 0,
      })
    ).rejects.toThrow('worker_command_epoch_runtime_generation_invalid');
  });

  it('never reopens draining or closed epochs during recreate', async () => {
    const { service } = serviceHarness({
      record: activeRecord({ state: 'draining' }),
      revision: 4,
    });

    await expect(
      service.activateRuntime({
        accountId,
        workerId,
        runtimeWriterEpoch: writerEpochB,
        runtimeGeneration: 2,
      })
    ).rejects.toThrow('worker_command_epoch_draining');

    const closedHarness = serviceHarness({
      record: activeRecord({
        state: 'closed',
        closed_at: '2026-08-13T12:02:00.000Z',
      }),
      revision: 5,
    });
    await expect(
      closedHarness.service.activateRuntime({
        accountId,
        workerId,
        runtimeWriterEpoch: writerEpochB,
        runtimeGeneration: 2,
      })
    ).rejects.toThrow('worker_command_epoch_closed');
  });

  it('migrates a legacy coupled record without rotating its accepted origin epoch', async () => {
    const legacy = activeRecord({
      epoch: writerEpochA,
      runtime_writer_epoch: undefined,
    });
    const { service } = serviceHarness({ record: legacy, revision: 9 });

    const migrated = await service.activateRuntime({
      accountId,
      workerId,
      runtimeWriterEpoch: writerEpochA,
      runtimeGeneration: 1,
      now: new Date('2026-08-13T12:03:00.000Z'),
    });
    expect(migrated.record.epoch).toBe(writerEpochA);
    expect(migrated.record.runtime_writer_epoch).toBe(writerEpochA);

    const recreated = await service.activateRuntime({
      accountId,
      workerId,
      runtimeWriterEpoch: writerEpochB,
      runtimeGeneration: 2,
      now: new Date('2026-08-13T12:04:00.000Z'),
    });
    expect(recreated.record.epoch).toBe(writerEpochA);
    expect(recreated.record.runtime_writer_epoch).toBe(writerEpochB);
  });

  it('keeps permanent deletion terminal for the logical epoch', async () => {
    const { service } = serviceHarness({
      record: activeRecord(),
      revision: 11,
    });
    const draining = await service.transition(
      workerId,
      activeRecord().epoch,
      'draining',
      new Date('2026-08-13T12:05:00.000Z')
    );
    expect(draining.record.state).toBe('draining');
    const closed = await service.transition(
      workerId,
      draining.record.epoch,
      'closed',
      new Date('2026-08-13T12:06:00.000Z')
    );
    expect(closed.record).toMatchObject({
      epoch: activeRecord().epoch,
      state: 'closed',
      closed_at: '2026-08-13T12:06:00.000Z',
    });

    await expect(
      service.activateRuntime({
        accountId,
        workerId,
        runtimeWriterEpoch: writerEpochB,
        runtimeGeneration: 2,
      })
    ).rejects.toThrow('worker_command_epoch_closed');
  });
});
