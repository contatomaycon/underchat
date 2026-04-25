import 'reflect-metadata';
import { currentTime } from '@core/common/functions/currentTime';
import { EServerBuildJobStatus } from '@core/common/enums/EServerBuildJobStatus';
import { EServerBuildType } from '@core/common/enums/EServerBuildType';
import { ServerBuildRepository } from '@core/repositories/server/ServerBuild.repository';
import { v7 as uuidv7 } from 'uuid';

jest.mock('uuid', () => ({
  v7: jest.fn(),
}));

jest.mock('@core/common/functions/currentTime', () => ({
  currentTime: jest.fn(),
}));

function createChain(result: unknown) {
  const chain: any = {};

  chain.from = jest.fn(() => chain);
  chain.where = jest.fn(() => chain);
  chain.orderBy = jest.fn(() => chain);
  chain.limit = jest.fn(() => chain);
  chain.offset = jest.fn(() => chain);
  chain.innerJoin = jest.fn(() => chain);
  chain.leftJoin = jest.fn(() => chain);
  chain.values = jest.fn(() => chain);
  chain.set = jest.fn(() => chain);
  chain.returning = jest.fn(() => chain);
  chain.onConflictDoNothing = jest.fn(() => chain);
  chain.execute = jest.fn(async () => result);

  return chain;
}

function createSelectSequence(results: unknown[]) {
  const select = jest.fn();

  for (const result of results) {
    const chain = createChain(result);
    select.mockReturnValueOnce(chain);
  }

  return select;
}

describe('ServerBuildRepository', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (currentTime as unknown as jest.Mock).mockReturnValue(
      '2026-04-21T17:00:00.000Z'
    );
  });

  it('createBuildJob returns conflict when there is an active build job', async () => {
    (uuidv7 as unknown as jest.Mock).mockReturnValue('new-job-id');

    const select = createSelectSequence([
      [{ server_build_job_id: 'active-job-id' }],
    ]);

    const transaction = jest.fn(async (cb: (tx: unknown) => Promise<unknown>) =>
      cb({
        select,
        insert: jest.fn(),
      })
    );

    const repository = new ServerBuildRepository(
      { transaction } as never,
      {} as never
    );

    await expect(
      repository.createBuildJob('user-1', '1.0.0', [EServerBuildType.baileys])
    ).resolves.toEqual({
      conflict: true,
    });
  });

  it('createBuildJob returns conflict when unique index conflict happens', async () => {
    const transaction = jest.fn(async () => {
      throw new Error(
        'duplicate key value violates unique constraint server_build_job_active_unique_idx'
      );
    });

    const repository = new ServerBuildRepository(
      { transaction } as never,
      {} as never
    );

    await expect(
      repository.createBuildJob('user-1', '1.0.0', [EServerBuildType.baileys])
    ).resolves.toEqual({
      conflict: true,
    });
  });

  it('createBuildJob rejects empty or duplicated build types', async () => {
    const repository = new ServerBuildRepository({} as never, {} as never);

    await expect(
      repository.createBuildJob('user-1', '1.0.0', [])
    ).resolves.toEqual({
      conflict: false,
      invalid_reason: 'invalid_build_types',
    });

    await expect(
      repository.createBuildJob('user-1', '1.0.0', [
        EServerBuildType.baileys,
        EServerBuildType.baileys,
      ])
    ).resolves.toEqual({
      conflict: false,
      invalid_reason: 'invalid_build_types',
    });
  });

  it('createBuildJob creates job and selected items when there is no active job', async () => {
    (uuidv7 as unknown as jest.Mock)
      .mockReturnValueOnce('new-job-id')
      .mockReturnValueOnce('item-1')
      .mockReturnValueOnce('item-2');

    const select = createSelectSequence([[]]);
    const insert = jest.fn(() => createChain({ rowCount: 1 }));
    const transaction = jest.fn(async (cb: (tx: unknown) => Promise<unknown>) =>
      cb({
        select,
        insert,
      })
    );

    const repository = new ServerBuildRepository(
      { transaction } as never,
      {} as never
    );

    await expect(
      repository.createBuildJob('user-1', '1.0.0', [
        EServerBuildType.baileys,
        EServerBuildType.balance_api,
      ])
    ).resolves.toEqual({
      conflict: false,
      server_build_job_id: 'new-job-id',
      version: '1.0.0',
    });

    expect(insert).toHaveBeenCalledTimes(2);
    const itemInsertChain = insert.mock.results[1].value;
    const insertedItems = itemInsertChain.values.mock.calls[0][0];
    expect(insertedItems).toHaveLength(2);
    expect(
      insertedItems.map(
        (item: { build_type: EServerBuildType }) => item.build_type
      )
    ).toEqual([EServerBuildType.baileys, EServerBuildType.balance_api]);
  });

  it('createBuildJob rejects completion when version does not exist', async () => {
    (uuidv7 as unknown as jest.Mock).mockReturnValueOnce('new-job-id');

    const select = createSelectSequence([[], []]);
    const insert = jest.fn(() => createChain({ rowCount: 1 }));
    const transaction = jest.fn(async (cb: (tx: unknown) => Promise<unknown>) =>
      cb({
        select,
        insert,
      })
    );

    const repository = new ServerBuildRepository(
      { transaction } as never,
      {} as never
    );

    await expect(
      repository.createBuildJob(
        'user-1',
        '1.0.0',
        [EServerBuildType.wwebjs],
        true
      )
    ).resolves.toEqual({
      conflict: false,
      invalid_reason: 'version_not_found',
    });

    expect(insert).not.toHaveBeenCalled();
  });

  it('createBuildJob rejects completion when selected target already exists', async () => {
    (uuidv7 as unknown as jest.Mock).mockReturnValueOnce('new-job-id');

    const select = createSelectSequence([
      [],
      [{ server_build_version_id: 'version-1' }],
      [{ build_type: EServerBuildType.baileys }],
    ]);
    const insert = jest.fn(() => createChain({ rowCount: 1 }));
    const transaction = jest.fn(async (cb: (tx: unknown) => Promise<unknown>) =>
      cb({
        select,
        insert,
      })
    );

    const repository = new ServerBuildRepository(
      { transaction } as never,
      {} as never
    );

    await expect(
      repository.createBuildJob(
        'user-1',
        '1.0.0',
        [EServerBuildType.baileys],
        true
      )
    ).resolves.toEqual({
      conflict: false,
      invalid_reason: 'build_type_exists',
    });

    expect(insert).not.toHaveBeenCalled();
  });

  it('getBuildJobById returns null when build job does not exist', async () => {
    const select = createSelectSequence([[]]);
    const repository = new ServerBuildRepository(
      { select } as never,
      {} as never
    );

    await expect(repository.getBuildJobById('job-1')).resolves.toBeNull();
  });

  it('getBuildJobById returns job and keeps build type order', async () => {
    const select = createSelectSequence([
      [
        {
          server_build_job_id: 'job-1',
          requested_by: 'user-1',
          version: '1.0.0',
          status: EServerBuildJobStatus.running,
          error_message: null,
          created_at: '2026-04-21T10:00:00.000Z',
          updated_at: '2026-04-21T10:00:00.000Z',
          started_at: null,
          finished_at: null,
        },
      ],
      [
        {
          server_build_job_item_id: 'item-1',
          server_build_job_id: 'job-1',
          build_type: EServerBuildType.wwebjs,
          status: 'pending',
          image_reference: null,
          error_message: null,
          created_at: '2026-04-21T10:00:00.000Z',
          updated_at: '2026-04-21T10:00:00.000Z',
          started_at: null,
          finished_at: null,
        },
        {
          server_build_job_item_id: 'item-2',
          server_build_job_id: 'job-1',
          build_type: EServerBuildType.whatsmeow,
          status: 'pending',
          image_reference: null,
          error_message: null,
          created_at: '2026-04-21T10:00:00.000Z',
          updated_at: '2026-04-21T10:00:00.000Z',
          started_at: null,
          finished_at: null,
        },
        {
          server_build_job_item_id: 'item-3',
          server_build_job_id: 'job-1',
          build_type: EServerBuildType.balance_api,
          status: 'pending',
          image_reference: null,
          error_message: null,
          created_at: '2026-04-21T10:00:00.000Z',
          updated_at: '2026-04-21T10:00:00.000Z',
          started_at: null,
          finished_at: null,
        },
        {
          server_build_job_item_id: 'item-4',
          server_build_job_id: 'job-1',
          build_type: EServerBuildType.baileys,
          status: 'pending',
          image_reference: null,
          error_message: null,
          created_at: '2026-04-21T10:00:00.000Z',
          updated_at: '2026-04-21T10:00:00.000Z',
          started_at: null,
          finished_at: null,
        },
      ],
    ]);

    const repository = new ServerBuildRepository(
      { select } as never,
      {} as never
    );

    const result = await repository.getBuildJobById('job-1');

    expect(result?.items.map((item) => item.build_type)).toEqual([
      EServerBuildType.baileys,
      EServerBuildType.wwebjs,
      EServerBuildType.whatsmeow,
      EServerBuildType.balance_api,
    ]);
  });

  it('isCancelRequested returns false when job is not found', async () => {
    const select = createSelectSequence([[]]);
    const repository = new ServerBuildRepository(
      { select } as never,
      {} as never
    );

    await expect(repository.isCancelRequested('job-1')).resolves.toBe(false);
  });

  it('isCancelRequested returns true when status is cancel_requested', async () => {
    const select = createSelectSequence([
      [{ status: EServerBuildJobStatus.cancel_requested }],
    ]);
    const repository = new ServerBuildRepository(
      { select } as never,
      {} as never
    );

    await expect(repository.isCancelRequested('job-1')).resolves.toBe(true);
  });

  it('hasActiveBuildJob returns true when active build exists', async () => {
    const select = createSelectSequence([
      [{ server_build_job_id: 'active-job-id' }],
    ]);
    const repository = new ServerBuildRepository(
      { select } as never,
      {} as never
    );

    await expect(repository.hasActiveBuildJob()).resolves.toBe(true);
  });

  it('hasActiveBuildJob returns false when there is no active build', async () => {
    const select = createSelectSequence([[]]);
    const repository = new ServerBuildRepository(
      { select } as never,
      {} as never
    );

    await expect(repository.hasActiveBuildJob()).resolves.toBe(false);
  });

  it('getBuildJobSummaryById returns null when job does not exist', async () => {
    const select = createSelectSequence([[]]);
    const repository = new ServerBuildRepository(
      { select } as never,
      {} as never
    );

    await expect(
      repository.getBuildJobSummaryById('job-1')
    ).resolves.toBeNull();
  });

  it('getBuildJobSummaryById returns summary payload when job exists', async () => {
    const select = createSelectSequence([
      [
        {
          server_build_job_id: 'job-1',
          version: '1.0.0',
          status: EServerBuildJobStatus.completed,
        },
      ],
    ]);
    const repository = new ServerBuildRepository(
      { select } as never,
      {} as never
    );

    await expect(repository.getBuildJobSummaryById('job-1')).resolves.toEqual({
      server_build_job_id: 'job-1',
      version: '1.0.0',
      status: EServerBuildJobStatus.completed,
    });
  });

  it('isBuildVersionDefault returns false when no row matches', async () => {
    const select = createSelectSequence([[]]);
    const repository = new ServerBuildRepository(
      { select } as never,
      {} as never
    );

    await expect(repository.isBuildVersionDefault('1.0.0')).resolves.toBe(
      false
    );
  });

  it('isBuildVersionDefault returns true when version is default', async () => {
    const select = createSelectSequence([
      [{ server_build_version_id: 'version-1' }],
    ]);
    const repository = new ServerBuildRepository(
      { select } as never,
      {} as never
    );

    await expect(repository.isBuildVersionDefault('1.0.0')).resolves.toBe(true);
  });

  it('getDefaultImages returns null when any default image is missing', async () => {
    const select = createSelectSequence([
      [
        {
          build_type: EServerBuildType.baileys,
          image_reference: 'harbor/baileys:1.0.0',
        },
      ],
    ]);

    const repository = new ServerBuildRepository(
      { select } as never,
      {} as never
    );

    await expect(repository.getDefaultImages()).resolves.toBeNull();
  });

  it('getDefaultImages returns all default image references when available', async () => {
    const select = createSelectSequence([
      [
        {
          build_type: EServerBuildType.baileys,
          image_reference: 'harbor/baileys:1.0.0',
        },
        {
          build_type: EServerBuildType.wwebjs,
          image_reference: 'harbor/wwebjs:1.0.0',
        },
        {
          build_type: EServerBuildType.whatsmeow,
          image_reference: 'harbor/whatsmeow:1.0.0',
        },
        {
          build_type: EServerBuildType.balance_api,
          image_reference: 'harbor/balance_api:1.0.0',
        },
      ],
    ]);

    const repository = new ServerBuildRepository(
      { select } as never,
      {} as never
    );

    await expect(repository.getDefaultImages()).resolves.toEqual({
      baileys: 'harbor/baileys:1.0.0',
      wwebjs: 'harbor/wwebjs:1.0.0',
      whatsmeow: 'harbor/whatsmeow:1.0.0',
      balance_api: 'harbor/balance_api:1.0.0',
    });
  });
});
