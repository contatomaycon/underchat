import 'reflect-metadata';
import { LabelTemplateListerRepository } from '@core/repositories/labelTemplate/LabelTemplateLister.repository';

function createListChain(result: unknown[]) {
  const queryBuilder = {
    leftJoin: jest.fn(),
    where: jest.fn(),
    orderBy: jest.fn(),
    limit: jest.fn(),
    offset: jest.fn(),
    execute: jest.fn(async () => result),
  } as any;

  queryBuilder.leftJoin.mockReturnValue(queryBuilder);
  queryBuilder.where.mockReturnValue(queryBuilder);
  queryBuilder.orderBy.mockReturnValue(queryBuilder);
  queryBuilder.limit.mockReturnValue(queryBuilder);
  queryBuilder.offset.mockReturnValue(queryBuilder);

  const from = jest.fn(() => queryBuilder);
  const select = jest.fn(() => ({ from }));

  return { select };
}

function createTotalChain(result: unknown[]) {
  const execute = jest.fn(async () => result);
  const where = jest.fn(() => ({ execute }));
  const queryBuilder = {
    leftJoin: jest.fn(),
    where: jest.fn(),
  } as any;
  queryBuilder.leftJoin.mockReturnValue(queryBuilder);
  queryBuilder.where.mockReturnValue({ execute });
  const from = jest.fn(() => queryBuilder);
  const select = jest.fn(() => ({ from }));

  return { select };
}

describe('LabelTemplateListerRepository', () => {
  it('returns empty list when query has no rows', async () => {
    const chain = createListChain([]);
    const dbRo = {
      select: chain.select,
    };
    const repository = new LabelTemplateListerRepository(dbRo as never);

    await expect(
      repository.listLabelTemplates(10, 1, {} as never, 'acc-1')
    ).resolves.toEqual([]);
  });

  it('maps listLabelTemplates result', async () => {
    const chain = createListChain([
      {
        label_template_id: 'lt-1',
        label: 'VIP',
        color: '#111',
        account: { account_id: 'acc-1', name: 'Account' },
        label_status: { label_status_id: 'active', name: 'Ativo' },
        created_at: '2026-01-01',
      },
    ]);
    const dbRo = {
      select: chain.select,
    };
    const repository = new LabelTemplateListerRepository(dbRo as never);

    await expect(
      repository.listLabelTemplates(10, 1, {} as never, 'acc-1')
    ).resolves.toEqual([
      {
        label_template_id: 'lt-1',
        account: { account_id: 'acc-1', name: 'Account' },
        label_status: { label_status_id: 'active', name: 'Ativo' },
        label: 'VIP',
        color: '#111',
        created_at: '2026-01-01',
      },
    ]);
  });

  it('returns total count for listLabelTemplateTotal', async () => {
    const chain = createTotalChain([{ count: 5 }]);
    const dbRo = { select: chain.select };
    const repository = new LabelTemplateListerRepository(dbRo as never);

    await expect(
      repository.listLabelTemplateTotal({} as never, 'acc-1')
    ).resolves.toBe(5);
  });
});
