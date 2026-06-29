import 'reflect-metadata';
import { ChannelsListerRepository } from '@core/repositories/config/ChannelsLister.repository';
import { EWorkerStatus } from '@core/common/enums/EWorkerStatus';
import { EWorkerType } from '@core/common/enums/EWorkerType';

function createListChain(result: unknown[]) {
  const queryBuilder = {
    innerJoin: jest.fn(),
    where: jest.fn(),
    orderBy: jest.fn(),
    limit: jest.fn(),
    offset: jest.fn(),
    execute: jest.fn(async () => result),
  } as any;
  queryBuilder.innerJoin.mockReturnValue(queryBuilder);
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
    where,
  } as any;
  queryBuilder.innerJoin.mockReturnValue(queryBuilder);
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
    ]);
    const dbRo = { select: chain.select };
    const repository = new ChannelsListerRepository(dbRo as never);

    await expect(repository.listChannels(10, 1, {} as never)).resolves.toEqual([
      {
        id: 'w1',
        name: 'Channel',
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
    ]);
  });

  it('returns total and all non-deleted channel ids', async () => {
    const totalChain = createCountChain([{ count: 2 }]);
    const idsChain = createCountChain([
      { worker_id: 'w1', server_id: 'srv-1' },
      { worker_id: 'w2', server_id: 'srv-2' },
    ]);
    const targetsChain = createCountChain([
      { worker_id: 'w1', server_id: 'srv-1' },
      { worker_id: 'w2', server_id: 'srv-2' },
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
      { worker_id: 'w1', server_id: 'srv-1' },
      { worker_id: 'w2', server_id: 'srv-2' },
    ]);
  });

  it('keeps exact filters and searches name or number for recreate-all ids', async () => {
    const chain = createCountChain([{ worker_id: 'w1', server_id: 'srv-1' }]);
    const dbRo = { select: chain.select };
    const repository = new ChannelsListerRepository(dbRo as never);

    await expect(
      repository.listAllNonDeletedChannelRecreateTargets({
        status: EWorkerStatus.error,
        type: EWorkerType.baileys,
        account: 'acc-1',
        name: 'Display',
        number: '5511999999999',
      })
    ).resolves.toEqual([{ worker_id: 'w1', server_id: 'srv-1' }]);

    const whereSql = collectSqlParts(
      chain.queryBuilder.where.mock.calls[0][0]
    ).join(' ');

    expect(whereSql).toContain(EWorkerStatus.error);
    expect(whereSql).toContain(EWorkerType.baileys);
    expect(whereSql).toContain(EWorkerType.whatsapp);
    expect(whereSql).toContain('acc-1');
    expect(whereSql).toContain('%Display%');
    expect(whereSql).toContain('%5511999999999%');
    expect(whereSql).toContain(' or ');
  });
});
