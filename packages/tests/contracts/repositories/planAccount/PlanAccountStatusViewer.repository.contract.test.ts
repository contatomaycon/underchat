import 'reflect-metadata';
import { PlanAccountStatusViewerRepository } from '@core/repositories/planAccount/PlanAccountStatusViewer.repository';

function createSelectChain(result: unknown[]) {
  const execute = jest.fn(async () => result);
  const limit = jest.fn(() => ({ execute }));
  const orderBy = jest.fn(() => ({ limit }));
  const where = jest.fn(() => ({ orderBy }));
  const innerJoin = jest.fn(() => ({ where }));
  const from = jest.fn(() => ({ innerJoin }));
  const select = jest.fn(() => ({ from }));

  return {
    dbRo: { select },
  };
}

describe('PlanAccountStatusViewerRepository', () => {
  it('returns null when there is no plan account status', async () => {
    const { dbRo } = createSelectChain([]);
    const repository = new PlanAccountStatusViewerRepository(dbRo as never);

    await expect(repository.viewLatestByAccountId('acc-1')).resolves.toBeNull();
  });

  it('returns latest plan account status', async () => {
    const row = {
      account_status_id: 'active',
      next_payment_date: '2026-05-01T00:00:00.000Z',
      cancellation_date: null,
    };
    const { dbRo } = createSelectChain([row]);
    const repository = new PlanAccountStatusViewerRepository(dbRo as never);

    await expect(repository.viewLatestByAccountId('acc-1')).resolves.toEqual(
      row
    );
  });
});
