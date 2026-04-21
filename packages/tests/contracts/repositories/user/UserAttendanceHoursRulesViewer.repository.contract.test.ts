import 'reflect-metadata';
import { UserAttendanceHoursRulesViewerRepository } from '@core/repositories/user/UserAttendanceHoursRulesViewer.repository';
import { createSelectDbMock } from '../../../helpers/drizzleMock';

describe('UserAttendanceHoursRulesViewerRepository', () => {
  it('returns empty list when query has no rules', async () => {
    const dbMock = createSelectDbMock([]);
    const repository = new UserAttendanceHoursRulesViewerRepository(
      dbMock.db as never
    );

    await expect(
      repository.listUserAttendanceHoursRules('user-1', 'account-1')
    ).resolves.toEqual([]);
  });

  it('maps attendance rules payload', async () => {
    const dbMock = createSelectDbMock([
      { weekday: 1, start_time: '08:00', end_time: '18:00' },
      { weekday: 2, start_time: '09:00', end_time: '17:00' },
    ]);
    const repository = new UserAttendanceHoursRulesViewerRepository(
      dbMock.db as never
    );

    await expect(
      repository.listUserAttendanceHoursRules('user-1', 'account-1')
    ).resolves.toEqual([
      { weekday: 1, start_time: '08:00', end_time: '18:00' },
      { weekday: 2, start_time: '09:00', end_time: '17:00' },
    ]);
  });
});
