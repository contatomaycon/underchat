import 'reflect-metadata';
import { ESortOrder } from '@core/common/enums/ESortOrder';
import { createSelectDbMock } from '@core/tests/helpers/drizzleMock';
import { IntegrationListerRepository } from '@core/repositories/integration/IntegrationLister.repository';

function createListChain(result: unknown) {
  const chain = {} as {
    from: jest.Mock;
    leftJoin: jest.Mock;
    where: jest.Mock;
    orderBy: jest.Mock;
    limit: jest.Mock;
    offset: jest.Mock;
    execute: jest.Mock;
  };

  chain.from = jest.fn(() => chain);
  chain.leftJoin = jest.fn(() => chain);
  chain.where = jest.fn(() => chain);
  chain.orderBy = jest.fn(() => chain);
  chain.limit = jest.fn(() => chain);
  chain.offset = jest.fn(() => chain);
  chain.execute = jest.fn(async () => result);

  return chain;
}

describe('IntegrationListerRepository', () => {
  it('listIntegrations maps results and applies explicit sort ordering', async () => {
    const chain = createListChain([
      {
        api_key_id: 'api-key-1',
        name: 'Integration A',
        status: 'active',
        worker_id: 'worker-1',
        worker_name: 'Worker A',
      },
    ]);
    const repository = new IntegrationListerRepository({
      select: jest.fn(() => chain),
    } as never);

    await expect(
      repository.listIntegrations('acc-1', 10, 1, {
        search: 'Integration',
        status: 'active',
        sort_by: [
          { key: 'name', order: ESortOrder.asc },
          { key: 'status', order: ESortOrder.desc },
          { key: 'created_at', order: ESortOrder.asc },
          { key: 'updated_at', order: ESortOrder.desc },
        ],
      } as never)
    ).resolves.toEqual([
      {
        api_key_id: 'api-key-1',
        name: 'Integration A',
        status: 'active',
        worker_id: 'worker-1',
        worker_name: 'Worker A',
      },
    ]);
    expect(chain.orderBy).toHaveBeenCalledTimes(1);
  });

  it('listIntegrations returns empty array when query has no rows', async () => {
    const chain = createListChain([]);
    const repository = new IntegrationListerRepository({
      select: jest.fn(() => chain),
    } as never);

    await expect(
      repository.listIntegrations('acc-1', 10, 1, {} as never)
    ).resolves.toEqual([]);
  });

  it('listIntegrationsTotal returns count with zero fallback', async () => {
    const withCount = createSelectDbMock([{ count: 11 }]);
    const repositoryWithCount = new IntegrationListerRepository(
      withCount.db as never
    );
    await expect(
      repositoryWithCount.listIntegrationsTotal('acc-1', {
        search: 'Integration',
        status: 'active',
      } as never)
    ).resolves.toBe(11);

    const withoutCount = createSelectDbMock([]);
    const repositoryWithoutCount = new IntegrationListerRepository(
      withoutCount.db as never
    );
    await expect(
      repositoryWithoutCount.listIntegrationsTotal('acc-1', {} as never)
    ).resolves.toBe(0);
  });
});
