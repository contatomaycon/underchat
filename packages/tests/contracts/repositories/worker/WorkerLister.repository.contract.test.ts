import 'reflect-metadata';
import { EWorkerStatus } from '@core/common/enums/EWorkerStatus';
import { EWorkerType } from '@core/common/enums/EWorkerType';
import { WorkerListerRepository } from '@core/repositories/worker/WorkerLister.repository';

function createListWorkerSelect(result: unknown[]) {
  const chain: {
    innerJoin: jest.Mock;
    leftJoin: jest.Mock;
    where: jest.Mock;
    orderBy: jest.Mock;
    limit: jest.Mock;
    offset: jest.Mock;
    execute: jest.Mock;
  } = {
    innerJoin: jest.fn(),
    leftJoin: jest.fn(),
    where: jest.fn(),
    orderBy: jest.fn(),
    limit: jest.fn(),
    offset: jest.fn(),
    execute: jest.fn(async () => result),
  };

  chain.innerJoin.mockReturnValue(chain);
  chain.leftJoin.mockReturnValue(chain);
  chain.where.mockReturnValue(chain);
  chain.orderBy.mockReturnValue(chain);
  chain.limit.mockReturnValue(chain);
  chain.offset.mockReturnValue(chain);

  return {
    from: jest.fn(() => chain),
    chain,
  };
}

function createListWorkerTotalSelect(result: unknown[]) {
  const chain: {
    innerJoin: jest.Mock;
    leftJoin: jest.Mock;
    where: jest.Mock;
    execute: jest.Mock;
  } = {
    innerJoin: jest.fn(),
    leftJoin: jest.fn(),
    where: jest.fn(),
    execute: jest.fn(async () => result),
  };

  chain.innerJoin.mockReturnValue(chain);
  chain.leftJoin.mockReturnValue(chain);
  chain.where.mockReturnValue(chain);

  return {
    from: jest.fn(() => chain),
    chain,
  };
}

function collectSqlParts(value: unknown): string[] {
  if (!value) return [];
  if (typeof value !== 'object') return [String(value)];
  const record = value as {
    queryChunks?: unknown[];
    value?: unknown;
    name?: unknown;
    columnType?: unknown;
  };
  if (Array.isArray(record.queryChunks)) {
    return record.queryChunks.flatMap((chunk) => collectSqlParts(chunk));
  }
  if (Array.isArray(record.value)) return record.value.map(String);
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

describe('WorkerListerRepository', () => {
  it('setOrders returns default and custom order clauses', () => {
    const repository = new WorkerListerRepository({} as never);

    const defaultOrders = (repository as any).setOrders({} as never);
    const customOrders = (repository as any).setOrders({
      sort_by: [{ key: 'name', order: 'asc' }],
    } as never);

    expect(defaultOrders).toHaveLength(2);
    expect(customOrders).toHaveLength(1);
  });

  it('setFilters builds status/type/text filters', () => {
    const repository = new WorkerListerRepository({} as never);

    const filters = (repository as any).setFilters({
      name: 'Worker',
      number: '5511',
      server: 'Server',
      account: 'Account',
      status: 'online',
      type: 'baileys',
    } as never);

    expect(filters.length).toBeGreaterThanOrEqual(3);
  });

  it('uses the persisted worker pointer for the canonical online status', () => {
    const repository = new WorkerListerRepository({} as never);

    const filters = (repository as any).setFilters({
      status: EWorkerStatus.online,
    } as never);

    expect(filters).toHaveLength(1);
  });

  it('uses the persisted worker status for filters and sorting', () => {
    const repository = new WorkerListerRepository({} as never);
    const filters = (repository as any).setFilters({
      status: EWorkerStatus.offline,
    });
    const orders = (repository as any).setOrders({
      sort_by: [{ key: 'status', order: 'asc' }],
    });

    expect(collectSqlParts(filters[0]).join(' ')).toContain('worker_status_id');
    expect(collectSqlParts(filters[0]).join(' ')).not.toContain(
      'native_connection_public_status'
    );
    expect(collectSqlParts(orders[0]).join(' ')).toContain('status');
    expect(collectSqlParts(orders[0]).join(' ')).not.toContain(
      'native_connection_public_status'
    );
  });

  it('listWorker returns empty array when query has no rows', async () => {
    const repository = new WorkerListerRepository({
      select: jest.fn(() => createListWorkerSelect([])),
    } as never);

    await expect(
      repository.listWorker('account-1', 10, 1, {} as never)
    ).resolves.toEqual([]);
  });

  it('hides deletion lifecycle rows from worker list and totals', async () => {
    const listSelect = createListWorkerSelect([]);
    const totalSelect = createListWorkerTotalSelect([{ count: 0 }]);
    const listRepository = new WorkerListerRepository({
      select: jest.fn(() => listSelect),
    } as never);
    const totalRepository = new WorkerListerRepository({
      select: jest.fn(() => totalSelect),
    } as never);

    await listRepository.listWorker('account-1', 10, 1, {} as never);
    await totalRepository.listWorkerTotal('account-1', {} as never);

    const listWhere = collectSqlParts(
      listSelect.chain.where.mock.calls[0]?.[0]
    ).join(' ');
    const totalWhere = collectSqlParts(
      totalSelect.chain.where.mock.calls[0]?.[0]
    ).join(' ');

    for (const whereSql of [listWhere, totalWhere]) {
      expect(whereSql).toContain('worker_status_id');
      expect(whereSql).toContain('not in');
    }
  });

  it('listWorker maps worker rows', async () => {
    const repository = new WorkerListerRepository({
      select: jest.fn(() =>
        createListWorkerSelect([
          {
            id: 'w-1',
            name: 'Worker 1',
            number: '5511999999999',
            status: { id: 'online', name: 'Online' },
            type: { id: 'baileys', name: 'Baileys' },
            server: { id: 's-1', name: 'Server 1' },
            account: { id: 'a-1', name: 'Account 1' },
            session_storage: 'postgres',
            connection_date: null,
            last_connection_check_at: null,
            recreate_available_at: '2026-06-11T12:02:00.000Z',
            created_at: '2026-04-20T10:00:00.000Z',
            updated_at: '2026-04-21T10:00:00.000Z',
            lifecycle_operation_id: '33333333-3333-7333-8333-333333333333',
          },
          {
            id: 'w-official',
            name: 'Official',
            number: '5561999990000',
            status: { id: 'online', name: 'Online' },
            type: { id: 'whatsapp', name: 'WhatsApp' },
            server: null,
            account: { id: 'a-1', name: 'Account 1' },
            session_storage: 'legacy_volume',
            connection_date: '2026-07-03T00:13:47.000Z',
            last_connection_check_at: null,
            recreate_available_at: null,
            created_at: '2026-07-02T23:39:59.000Z',
            updated_at: '2026-07-05T07:50:26.000Z',
            official_business_id: '294792833281367',
            official_waba_id: '1559502645897944',
          },
        ])
      ),
    } as never);

    await expect(
      repository.listWorker('account-1', 10, 1, {} as never)
    ).resolves.toEqual([
      {
        id: 'w-1',
        name: 'Worker 1',
        number: '5511999999999',
        status: { id: 'online', name: 'Online' },
        type: { id: 'baileys', name: 'Baileys' },
        server: { id: 's-1', name: 'Server 1' },
        account: { id: 'a-1', name: 'Account 1' },
        session_storage: 'postgres',
        connection_date: null,
        last_connection_check_at: null,
        recreate_available_at: '2026-06-11T12:02:00.000Z',
        created_at: '2026-04-20T10:00:00.000Z',
        updated_at: '2026-04-21T10:00:00.000Z',
        connection_status: null,
        connection_status_source_id: null,
        connection_status_order: null,
        connection_online_acknowledged: false,
        lifecycle_operation_id: '33333333-3333-7333-8333-333333333333',
        provider_handoff_recovery: null,
      },
      {
        id: 'w-official',
        name: 'Official',
        number: '5561999990000',
        status: { id: 'online', name: 'Online' },
        type: { id: 'whatsapp', name: 'WhatsApp' },
        server: null,
        account: { id: 'a-1', name: 'Account 1' },
        session_storage: 'legacy_volume',
        connection_date: '2026-07-03T00:13:47.000Z',
        last_connection_check_at: null,
        recreate_available_at: null,
        created_at: '2026-07-02T23:39:59.000Z',
        updated_at: '2026-07-05T07:50:26.000Z',
        official_template_manager_url:
          'https://business.facebook.com/latest/whatsapp_manager/message_templates?asset_id=1559502645897944&business_id=294792833281367&tab=message-templates&nav_ref=whatsapp_manager',
        connection_status: null,
        connection_status_source_id: null,
        connection_status_order: null,
        connection_online_acknowledged: false,
        provider_handoff_recovery: null,
      },
    ]);
  });

  it('exposes a reload-safe handoff marker from the durable resolution after cascade', async () => {
    const select = jest.fn((selection: Record<string, unknown>) => {
      const query = createListWorkerSelect([]);
      (
        query as typeof query & { selection: Record<string, unknown> }
      ).selection = selection;
      return query;
    });
    const repository = new WorkerListerRepository({ select } as never);

    await repository.listWorker('account-1', 10, 1, {} as never);

    const selection = select.mock.calls[0]?.[0] as Record<string, unknown>;
    const markerSql = collectSqlParts(selection.provider_handoff_recovery).join(
      ' '
    );
    expect(markerSql).toContain('COALESCE');
    expect(markerSql).toContain('whatsapp_session_handoff');
    expect(markerSql).toContain('whatsapp_session_handoff_resolution');
    expect(markerSql).toContain('handoff_lifecycle_operation_id');
    expect(markerSql).toContain("resolution.state <> 'completed'");
  });

  it('returns persisted disponible while an unofficial channel is pairing', async () => {
    const repository = new WorkerListerRepository({
      select: jest.fn(() =>
        createListWorkerSelect([
          {
            id: 'w-qr',
            name: 'QR flow',
            number: null,
            status: { id: EWorkerStatus.disponible, name: 'Disponível' },
            type: { id: EWorkerType.wwebjs, name: 'WWebJS' },
            server: null,
            account: { id: 'a-1', name: 'Account' },
            session_storage: 'postgres',
            connection_date: null,
            last_connection_check_at: null,
            recreate_available_at: null,
            created_at: null,
            updated_at: null,
          },
        ])
      ),
    } as never);

    const [result] = await repository.listWorker(
      'account-1',
      10,
      1,
      {} as never
    );
    expect(result?.status).toEqual({
      id: EWorkerStatus.disponible,
      name: 'Disponível',
    });
  });

  it('exposes connecting from the exact marker after the worker pointer advances', async () => {
    const repository = new WorkerListerRepository({
      select: jest.fn(() =>
        createListWorkerSelect([
          {
            id: 'w-recreate',
            name: 'Recreate',
            number: null,
            status: {
              id: EWorkerStatus.recreating,
              name: 'recreating',
            },
            type: { id: EWorkerType.wwebjs, name: 'WWebJS' },
            server: null,
            account: { id: 'a-1', name: 'Account' },
            session_storage: 'postgres',
            connection_date: null,
            last_connection_check_at: null,
            recreate_available_at: null,
            created_at: null,
            updated_at: '2026-08-07T12:00:00.000Z',
            worker_container_id: 'b'.repeat(64),
            runtime_container_id: 'b'.repeat(64),
            runtime_generation: 16,
            lifecycle_operation_id: '019fdf2c-63af-73e2-8107-3442eeeb8e19',
            recreate_bootstrap_operation_id:
              '019fdf2c-63af-73e2-8107-3442eeeb8e19',
            recreate_bootstrap_runtime_generation: 16,
            recreate_bootstrap_container_id: 'b'.repeat(64),
            recreate_bootstrap_started_at: '2026-08-07T12:00:01.000Z',
          },
        ])
      ),
    } as never);

    const [result] = await repository.listWorker(
      'account-1',
      10,
      1,
      {} as never
    );

    expect(result).toMatchObject({
      status: { id: EWorkerStatus.recreating },
      runtime_generation: 16,
      lifecycle_operation_id: '019fdf2c-63af-73e2-8107-3442eeeb8e19',
      recreate_phase: 'connecting',
      recreate_phase_observed_at: '2026-08-07T12:00:01.000Z',
      recreate_runtime_retired: false,
    });
    expect(result).not.toHaveProperty('worker_container_id');
    expect(result).not.toHaveProperty('runtime_container_id');
  });

  it('keeps a bound replacement target recreating until it self-activates', async () => {
    const repository = new WorkerListerRepository({
      select: jest.fn(() =>
        createListWorkerSelect([
          {
            id: 'w-pending-target',
            name: 'Pending target',
            number: null,
            status: {
              id: EWorkerStatus.recreating,
              name: 'recreating',
            },
            type: { id: EWorkerType.whatsmeow, name: 'Whatsmeow' },
            server: null,
            account: { id: 'a-1', name: 'Account' },
            session_storage: 'postgres',
            connection_date: null,
            last_connection_check_at: null,
            recreate_available_at: null,
            created_at: null,
            updated_at: '2026-08-07T12:00:00.000Z',
            worker_updated_at: '2026-08-07T12:00:00.000Z',
            runtime_activated_at: '2026-08-07T12:00:01.000Z',
            runtime_connection_activated_at: null,
            worker_container_id: 'a'.repeat(64),
            runtime_container_id: 'b'.repeat(64),
            runtime_generation: 17,
            lifecycle_operation_id: '019fdf2c-63af-73e2-8107-3442eeeb8e19',
          },
        ])
      ),
    } as never);

    const [result] = await repository.listWorker(
      'account-1',
      10,
      1,
      {} as never
    );

    expect(result).toMatchObject({
      status: { id: EWorkerStatus.recreating },
      recreate_phase: 'recreating',
      recreate_runtime_retired: false,
    });
    expect(result).not.toHaveProperty('recreate_phase_observed_at');
  });

  it('listWorkerTotal returns count and zero fallback', async () => {
    const repository = new WorkerListerRepository({
      select: jest.fn(() => createListWorkerTotalSelect([{ count: 5 }])),
    } as never);
    const repositoryZero = new WorkerListerRepository({
      select: jest.fn(() => createListWorkerTotalSelect([])),
    } as never);

    await expect(
      repository.listWorkerTotal('account-1', {} as never)
    ).resolves.toBe(5);
    await expect(
      repositoryZero.listWorkerTotal('account-1', {} as never)
    ).resolves.toBe(0);
  });
});
