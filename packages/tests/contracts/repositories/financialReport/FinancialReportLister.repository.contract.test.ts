import 'reflect-metadata';
import { FinancialReportListerRepository } from '@core/repositories/financialReport/FinancialReportLister.repository';

function createSelectChain(result: unknown[]) {
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

describe('FinancialReportListerRepository', () => {
  it('returns zeroed monthly report when there is no data', async () => {
    const paymentsChain = createSelectChain([]);
    const expendituresChain = createSelectChain([]);
    const dbRo = {
      select: jest
        .fn()
        .mockImplementationOnce(paymentsChain.select)
        .mockImplementationOnce(expendituresChain.select),
    };
    const repository = new FinancialReportListerRepository(dbRo as never);

    await expect(
      repository.listFinancialReport({ period: 'monthly' } as never)
    ).resolves.toEqual({
      total_income: '0',
      total_outgoing: '0',
      total_net: '0',
      monthly_details: [],
      daily_details: undefined,
    });
  });
});
