import 'reflect-metadata';
import { DashboardAttendanceRepository } from '@core/repositories/dashboard/DashboardAttendance.repository';

describe('DashboardAttendanceRepository', () => {
  it('returns 7-day attendance performance with zero values when no buckets exist', async () => {
    const elasticDatabaseService = {
      select: jest
        .fn()
        .mockResolvedValueOnce({ aggregations: { by_date: { buckets: [] } } })
        .mockResolvedValueOnce({ aggregations: { by_date: { buckets: [] } } }),
    };
    const repository = new DashboardAttendanceRepository(
      {} as never,
      elasticDatabaseService as never
    );

    const result = await repository.getAttendancePerformance('acc-1');

    expect(result).toHaveLength(7);
    expect(
      result.every((item) => item.performed === 0 && item.average === 0)
    ).toBe(true);
  });
});
