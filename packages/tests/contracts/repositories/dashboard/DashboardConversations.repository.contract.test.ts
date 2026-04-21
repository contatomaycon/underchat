import 'reflect-metadata';
import { DashboardConversationsRepository } from '@core/repositories/dashboard/DashboardConversations.repository';

describe('DashboardConversationsRepository', () => {
  it('returns active/closed counts from elastic total payload', async () => {
    const elasticDatabaseService = {
      select: jest
        .fn()
        .mockResolvedValueOnce({ hits: { total: { value: 3 } } })
        .mockResolvedValueOnce({ hits: { total: 8 } }),
    };
    const repository = new DashboardConversationsRepository(
      elasticDatabaseService as never
    );

    await expect(repository.getActiveChatsCount('acc-1')).resolves.toBe(3);
    await expect(repository.getClosedChatsCount('acc-1')).resolves.toBe(8);
  });

  it('returns 12-month conversations evolution', async () => {
    const repository = new DashboardConversationsRepository({
      select: jest.fn(),
    } as never);
    (repository as any).getChatsCountByStatusAndDateRange = jest.fn(
      async () => 2
    );

    const result = await repository.getConversationsEvolution('acc-1');

    expect(result).toHaveLength(12);
    expect(result[0]).toEqual(
      expect.objectContaining({
        active: 2,
        closed: 2,
      })
    );
  });
});
