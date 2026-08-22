import 'reflect-metadata';
import { ChannelsListerRepository } from '@core/repositories/config/ChannelsLister.repository';
import { EWorkerStatus } from '@core/common/enums/EWorkerStatus';
import { EWorkerType } from '@core/common/enums/EWorkerType';
import { EWorkerSessionStorage } from '@core/common/enums/EWorkerSessionStorage';
import { EWorkerRecreatePhase } from '@core/common/enums/EWorkerRecreatePhase';

function createListChain(result: unknown[]) {
  const queryBuilder = {
    innerJoin: jest.fn(),
    leftJoin: jest.fn(),
    where: jest.fn(),
    orderBy: jest.fn(),
    limit: jest.fn(),
    offset: jest.fn(),
    execute: jest.fn(async () => result),
  } as any;
  queryBuilder.innerJoin.mockReturnValue(queryBuilder);
  queryBuilder.leftJoin.mockReturnValue(queryBuilder);
  queryBuilder.where.mockReturnValue(queryBuilder);
  queryBuilder.orderBy.mockReturnValue(queryBuilder);
  queryBuilder.limit.mockReturnValue(queryBuilder);
  queryBuilder.offset.mockReturnValue(queryBuilder);

  const from = jest.fn(() => queryBuilder);
  const select = jest.fn(() => ({ from }));

  return { queryBuilder, select };
}

function createCountChain(result: unknown[]) {
  const execute = jest.fn(async () => result);
  const where = jest.fn(() => ({ execute }));
  const queryBuilder = {
    innerJoin: jest.fn(),
    leftJoin: jest.fn(),
    where,
  } as any;
  queryBuilder.innerJoin.mockReturnValue(queryBuilder);
  queryBuilder.leftJoin.mockReturnValue(queryBuilder);
  queryBuilder.where.mockReturnValue({ execute });
  const from = jest.fn(() => queryBuilder);
  const select = jest.fn(() => ({ from }));

  return { queryBuilder, select };
}

function collectSqlParts(value: unknown): string[] {
  if (!value) {
    return [];
  }

  if (typeof value !== 'object') {
    return [String(value)];
  }

  const record = value as {
    queryChunks?: unknown[];
    value?: unknown;
    name?: unknown;
    columnType?: unknown;
  };

  if (Array.isArray(record.queryChunks)) {
    return record.queryChunks.flatMap((chunk) => collectSqlParts(chunk));
  }

  if (Array.isArray(record.value)) {
    return record.value.map(String);
  }

  if ('value' in record && typeof record.value !== 'object') {
    return [String(record.value)];
  }

  if (
    typeof record.name === 'string' &&
    typeof record.columnType === 'string'
  ) {
    return [record.name];
  }

  return [];
}

describe('ChannelsListerRepository', () => {
  it('maps listChannels result', async () => {
    const chain = createListChain([
      {
        id: 'w1',
        name: 'Channel',
        session_storage: EWorkerSessionStorage.postgres,
        number: '551199999',
        status: { id: 'active', name: 'Ativo' },
        type: { id: 'wa', name: 'WhatsApp' },
        server: { id: 'srv-1', name: 'Srv' },
        account: { id: 'acc-1', name: 'Acc' },
        connection_date: '2026-01-01',
        last_connection_check_at: '2026-01-02',
        created_at: '2026-01-01',
        updated_at: '2026-01-02',
      },
      {
        id: 'w-official',
        name: 'Official',
        session_storage: EWorkerSessionStorage.postgres,
        number: '5561999990000',
        status: { id: 'online', name: 'Online' },
        type: { id: 'whatsapp', name: 'WhatsApp' },
        server: null,
        account: { id: 'acc-1', name: 'Acc' },
        connection_date: '2026-07-03',
        last_connection_check_at: null,
        created_at: '2026-07-02',
        updated_at: '2026-07-05',
      },
    ]);
    const dbRo = { select: chain.select };
    const repository = new ChannelsListerRepository(dbRo as never);

    await expect(repository.listChannels(10, 1, {} as never)).resolves.toEqual([
      {
        id: 'w1',
        name: 'Channel',
        session_storage: EWorkerSessionStorage.postgres,
        number: '551199999',
        status: { id: 'active', name: 'Ativo' },
        type: { id: 'wa', name: 'WhatsApp' },
        server: { id: 'srv-1', name: 'Srv' },
        account: { id: 'acc-1', name: 'Acc' },
        connection_date: '2026-01-01',
        last_connection_check_at: '2026-01-02',
        created_at: '2026-01-01',
        updated_at: '2026-01-02',
        session_storage_migration: null,
      },
      {
        id: 'w-official',
        name: 'Official',
        session_storage: EWorkerSessionStorage.postgres,
        number: '5561999990000',
        status: { id: 'online', name: 'Online' },
        type: { id: 'whatsapp', name: 'WhatsApp' },
        server: null,
        account: { id: 'acc-1', name: 'Acc' },
        connection_date: '2026-07-03',
        last_connection_check_at: null,
        created_at: '2026-07-02',
        updated_at: '2026-07-05',
        session_storage_migration: null,
      },
    ]);
  });

  it('filters channels by session storage for rows and total', async () => {
    const listChain = createListChain([]);
    const totalChain = createCountChain([{ count: 0 }]);
    const dbRo = {
      select: jest
        .fn()
        .mockImplementationOnce(listChain.select)
        .mockImplementationOnce(totalChain.select),
    };
    const repository = new ChannelsListerRepository(dbRo as never);
    const query = {
      session_storage: EWorkerSessionStorage.postgres,
    } as never;

    await expect(repository.listChannels(10, 1, query)).resolves.toEqual([]);
    await expect(repository.listChannelsTotal(query)).resolves.toBe(0);

    const listWhereSql = collectSqlParts(
      listChain.queryBuilder.where.mock.calls[0][0]
    ).join(' ');
    const totalWhereSql = collectSqlParts(
      totalChain.queryBuilder.where.mock.calls[0][0]
    ).join(' ');

    expect(listWhereSql).toContain(EWorkerSessionStorage.postgres);
    expect(totalWhereSql).toContain(EWorkerSessionStorage.postgres);
  });

  it('filters and sorts by the persisted worker status', () => {
    const repository = new ChannelsListerRepository({} as never);
    const filters = (repository as any).setFilters({
      status: EWorkerStatus.offline,
    });
    const orders = (repository as any).setOrders({
      sort_by: [{ key: 'status', order: 'asc' }],
    });
    const filterSql = collectSqlParts(filters[0]).join(' ');
    const orderSql = collectSqlParts(orders[0]).join(' ');

    expect(filterSql).toContain('worker_status_id');
    expect(filterSql).toContain(EWorkerStatus.offline);
    expect(filterSql).not.toContain('native_connection_public_status');
    expect(orderSql).toContain('status');
    expect(orderSql).not.toContain('native_connection_public_status');
  });

  it('includes the fenced recreate presentation in the connecting filter', () => {
    const repository = new ChannelsListerRepository({} as never);
    const filters = (repository as any).setFilters({
      status: EWorkerStatus.connecting,
    });
    const filterSql = collectSqlParts(filters[0]).join(' ');

    expect(filterSql).toContain(EWorkerStatus.connecting);
    expect(filterSql).toContain(EWorkerStatus.recreating);
    expect(filterSql).toContain('recreate_bootstrap_operation_id');
    expect(filterSql).toContain('recreate_bootstrap_runtime_generation');
    expect(filterSql).toContain('recreate_bootstrap_container_id');
    expect(filterSql).toContain('recreate_bootstrap_started_at');
    expect(filterSql).toContain('recreate_retired_operation_id');
  });

  it('reads status-filtered rows and total from the consistent database', async () => {
    const listChain = createListChain([]);
    const totalChain = createCountChain([{ count: 0 }]);
    const dbRo = { select: jest.fn() };
    const dbRw = {
      select: jest
        .fn()
        .mockImplementationOnce(listChain.select)
        .mockImplementationOnce(totalChain.select),
    };
    const repository = new ChannelsListerRepository(
      dbRo as never,
      dbRw as never
    );
    const query = { status: EWorkerStatus.connecting } as never;

    await expect(repository.listChannels(10, 1, query)).resolves.toEqual([]);
    await expect(repository.listChannelsTotal(query)).resolves.toBe(0);

    expect(dbRo.select).not.toHaveBeenCalled();
    expect(dbRw.select).toHaveBeenCalledTimes(2);
  });

  it('projects an authenticated bootstrapped recreate as connecting', async () => {
    const lifecycleOperationId = '019fee73-2adb-7c58-bdb7-4c3794836702';
    const containerId = 'abcdef123456';
    const listChain = createListChain([
      {
        id: 'w-recreating',
        name: 'Recreating channel',
        session_storage: EWorkerSessionStorage.postgres,
        number: '5511999999999',
        status: { id: EWorkerStatus.recreating, name: 'recreating' },
        type: { id: EWorkerType.baileys, name: 'Baileys' },
        server: { id: 'srv-1', name: 'Srv' },
        account: { id: 'acc-1', name: 'Acc' },
        connection_date: null,
        last_connection_check_at: null,
        created_at: '2026-01-01',
        updated_at: '2026-01-02',
        lifecycle_operation_id: lifecycleOperationId,
        worker_container_id: containerId,
        runtime_container_id: containerId,
        runtime_generation: 2,
        recreate_bootstrap_operation_id: lifecycleOperationId,
        recreate_bootstrap_runtime_generation: 2,
        recreate_bootstrap_container_id: containerId,
        recreate_bootstrap_started_at: '2026-08-15T12:00:00.000Z',
        recreate_retired_operation_id: null,
        recreate_retired_runtime_generation: null,
        recreate_retired_container_id: null,
        recreate_retired_at: null,
      },
    ]);
    const migrationChain = createListChain([]);
    const database = {
      select: jest
        .fn()
        .mockImplementationOnce(listChain.select)
        .mockImplementationOnce(migrationChain.select),
    };
    const repository = new ChannelsListerRepository(database as never);

    const [result] = await repository.listChannels(10, 1, {} as never);

    expect(result?.recreate_phase).toBe(EWorkerRecreatePhase.connecting);
  });

  it('keeps persisted ONLINE unchanged for administrators', async () => {
    const chain = createListChain([
      {
        id: 'w-unproven',
        name: 'Unproven',
        session_storage: EWorkerSessionStorage.postgres,
        number: '5511999999999',
        status: { id: EWorkerStatus.online, name: 'online' },
        type: { id: EWorkerType.baileys, name: 'Baileys' },
        server: { id: 'srv-1', name: 'Srv' },
        account: { id: 'acc-1', name: 'Acc' },
        connection_date: '2026-01-01',
        last_connection_check_at: '2026-01-02',
        created_at: '2026-01-01',
        updated_at: '2026-01-02',
      },
    ]);
    const repository = new ChannelsListerRepository({
      select: chain.select,
    } as never);

    const [result] = await repository.listChannels(10, 1, {} as never);
    expect(result?.status).toEqual({
      id: EWorkerStatus.online,
      name: 'online',
    });
  });

  it('keeps persisted disponible unchanged while a native QR flow is active', async () => {
    const chain = createListChain([
      {
        id: 'w-qr',
        name: 'QR flow',
        session_storage: EWorkerSessionStorage.postgres,
        number: null,
        status: { id: EWorkerStatus.disponible, name: 'disponible' },
        type: { id: EWorkerType.wwebjs, name: 'WWebJS' },
        server: { id: 'srv-1', name: 'Srv' },
        account: { id: 'acc-1', name: 'Acc' },
        connection_date: null,
        last_connection_check_at: null,
        created_at: '2026-01-01',
        updated_at: '2026-01-02',
      },
    ]);
    const repository = new ChannelsListerRepository({
      select: chain.select,
    } as never);

    const [result] = await repository.listChannels(10, 1, {} as never);
    expect(result?.status).toEqual({
      id: EWorkerStatus.disponible,
      name: 'disponible',
    });
  });

  it('returns total and all non-deleted channel ids', async () => {
    const totalChain = createCountChain([{ count: 2 }]);
    const idsChain = createCountChain([
      {
        worker_id: 'w1',
        worker_account_id: 'acc-1',
        server_id: 'srv-1',
        worker_type_id: EWorkerType.baileys,
        worker_status_id: EWorkerStatus.online,
        worker_container_id: 'container-1',
        runtime_container_id: 'container-1',
        runtime_generation: 1,
      },
      {
        worker_id: 'w2',
        worker_account_id: 'acc-2',
        server_id: 'srv-2',
        worker_type_id: EWorkerType.whatsmeow,
        worker_status_id: EWorkerStatus.online,
        worker_container_id: 'container-2',
        runtime_container_id: 'container-2',
        runtime_generation: 2,
      },
    ]);
    const targetsChain = createCountChain([
      {
        worker_id: 'w1',
        worker_account_id: 'acc-1',
        server_id: 'srv-1',
        worker_type_id: EWorkerType.baileys,
        worker_status_id: EWorkerStatus.online,
        worker_container_id: 'container-1',
        runtime_container_id: 'container-1',
        runtime_generation: 1,
      },
      {
        worker_id: 'w2',
        worker_account_id: 'acc-2',
        server_id: 'srv-2',
        worker_type_id: EWorkerType.whatsmeow,
        worker_status_id: EWorkerStatus.online,
        worker_container_id: 'container-2',
        runtime_container_id: 'container-2',
        runtime_generation: 2,
      },
    ]);
    const dbRo = {
      select: jest
        .fn()
        .mockImplementationOnce(totalChain.select)
        .mockImplementationOnce(idsChain.select)
        .mockImplementationOnce(targetsChain.select),
    };
    const repository = new ChannelsListerRepository(dbRo as never);

    await expect(repository.listChannelsTotal({} as never)).resolves.toBe(2);
    await expect(
      repository.listAllNonDeletedChannelIds({} as never)
    ).resolves.toEqual(['w1', 'w2']);
    await expect(
      repository.listAllNonDeletedChannelRecreateTargets({} as never)
    ).resolves.toEqual([
      {
        worker_id: 'w1',
        worker_account_id: 'acc-1',
        server_id: 'srv-1',
        worker_type_id: EWorkerType.baileys,
        worker_status_id: EWorkerStatus.online,
        worker_container_id: 'container-1',
        runtime_container_id: 'container-1',
        runtime_generation: 1,
      },
      {
        worker_id: 'w2',
        worker_account_id: 'acc-2',
        server_id: 'srv-2',
        worker_type_id: EWorkerType.whatsmeow,
        worker_status_id: EWorkerStatus.online,
        worker_container_id: 'container-2',
        runtime_container_id: 'container-2',
        runtime_generation: 2,
      },
    ]);
  });

  it('keeps exact filters and searches name or number for recreate-all ids', async () => {
    const chain = createCountChain([
      {
        worker_id: 'w1',
        worker_account_id: 'acc-1',
        server_id: 'srv-1',
        worker_type_id: EWorkerType.baileys,
        worker_status_id: EWorkerStatus.error,
        worker_container_id: null,
        runtime_container_id: null,
        runtime_generation: 7,
      },
    ]);
    const dbRo = { select: jest.fn() };
    const dbRw = { select: chain.select };
    const repository = new ChannelsListerRepository(
      dbRo as never,
      dbRw as never
    );

    await expect(
      repository.listAllNonDeletedChannelRecreateTargets({
        status: EWorkerStatus.error,
        type: EWorkerType.baileys,
        session_storage: EWorkerSessionStorage.legacy_volume,
        account: 'acc-1',
        name: 'Display',
        number: '5511999999999',
      })
    ).resolves.toEqual([
      {
        worker_id: 'w1',
        worker_account_id: 'acc-1',
        server_id: 'srv-1',
        worker_type_id: EWorkerType.baileys,
        worker_status_id: EWorkerStatus.error,
        worker_container_id: null,
        runtime_container_id: null,
        runtime_generation: 7,
      },
    ]);

    expect(dbRo.select).not.toHaveBeenCalled();
    expect(dbRw.select).toHaveBeenCalledTimes(1);

    const whereSql = collectSqlParts(
      chain.queryBuilder.where.mock.calls[0][0]
    ).join(' ');

    expect(whereSql).toContain(EWorkerStatus.error);
    expect(whereSql).toContain(EWorkerType.baileys);
    expect(whereSql).toContain(EWorkerSessionStorage.legacy_volume);
    expect(whereSql).toContain(EWorkerType.whatsapp);
    expect(whereSql).toContain('acc-1');
    expect(whereSql).toContain('%Display%');
    expect(whereSql).toContain('%5511999999999%');
    expect(whereSql).toContain(' or ');
  });
});
