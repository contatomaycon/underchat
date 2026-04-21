import 'reflect-metadata';
import { DashboardChatbotsRepository } from '@core/repositories/dashboard/DashboardChatbots.repository';

function createCountChain(total: number) {
  const execute = jest.fn(async () => [{ total }]);
  const where = jest.fn(() => ({ execute }));
  const from = jest.fn(() => ({ where }));
  const select = jest.fn(() => ({ from }));

  return { select };
}

describe('DashboardChatbotsRepository', () => {
  it('returns totals and allowed quantity', async () => {
    const totalChain = createCountChain(5);
    const activeChain = createCountChain(4);
    const dbRo = {
      select: jest
        .fn()
        .mockImplementationOnce(totalChain.select)
        .mockImplementationOnce(activeChain.select),
    };
    const accountQuantityProductViewerRepository = {
      viewAccountQuantityProduct: jest.fn(async () => 10),
    };
    const repository = new DashboardChatbotsRepository(
      dbRo as never,
      accountQuantityProductViewerRepository as never
    );

    await expect(repository.getChatbotsTotal('acc-1')).resolves.toBe(5);
    await expect(repository.getChatbotsActive('acc-1')).resolves.toBe(4);
    await expect(repository.getChatbotsAllowed('acc-1')).resolves.toBe(10);
  });
});
