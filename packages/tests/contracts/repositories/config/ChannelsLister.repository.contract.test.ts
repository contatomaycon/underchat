import 'reflect-metadata';
import { ChannelsListerRepository } from '@core/repositories/config/ChannelsLister.repository';

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

  return { select };
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

  return { select };
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
      { worker_id: 'w1' },
      { worker_id: 'w2' },
    ]);
    const dbRo = {
      select: jest
        .fn()
        .mockImplementationOnce(totalChain.select)
        .mockImplementationOnce(idsChain.select),
    };
    const repository = new ChannelsListerRepository(dbRo as never);

    await expect(repository.listChannelsTotal({} as never)).resolves.toBe(2);
    await expect(
      repository.listAllNonDeletedChannelIds({} as never)
    ).resolves.toEqual(['w1', 'w2']);
  });
});
