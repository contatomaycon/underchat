import 'reflect-metadata';
import { currentTime } from '@core/common/functions/currentTime';
import { EScheduleStatus } from '@core/common/enums/EScheduleStatus';
import { ScheduleStatusUpdaterRepository } from '@core/repositories/schedule/ScheduleStatusUpdater.repository';
import { createUpdateDbMock } from '@core/tests/helpers/drizzleMock';

jest.mock('@core/common/functions/currentTime', () => ({
  currentTime: jest.fn(),
}));

describe('ScheduleStatusUpdaterRepository', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (currentTime as unknown as jest.Mock).mockReturnValue(
      '2026-04-21T21:20:00.000Z'
    );
  });

  it('updateScheduleStatus returns based on rowCount', async () => {
    const withRows = createUpdateDbMock({ rowCount: 1 });
    const withoutRows = createUpdateDbMock({ rowCount: 0 });

    const withRepository = new ScheduleStatusUpdaterRepository(
      withRows.db as never
    );
    const withoutRepository = new ScheduleStatusUpdaterRepository(
      withoutRows.db as never
    );

    await expect(
      withRepository.updateScheduleStatus('sch-1', EScheduleStatus.processing)
    ).resolves.toBe(true);

    await expect(
      withoutRepository.updateScheduleStatus(
        'sch-1',
        EScheduleStatus.processing
      )
    ).resolves.toBe(false);
  });

  it('updateScheduleStatusIfCurrent returns false when currentStatuses is empty', async () => {
    const repository = new ScheduleStatusUpdaterRepository({
      update: jest.fn(),
    } as never);

    await expect(
      repository.updateScheduleStatusIfCurrent(
        'sch-1',
        EScheduleStatus.processing,
        []
      )
    ).resolves.toBe(false);
  });

  it('updateScheduleStatusIfCurrent returns based on rowCount when current statuses are provided', async () => {
    const withRows = createUpdateDbMock({ rowCount: 1 });
    const withoutRows = createUpdateDbMock({ rowCount: 0 });

    const withRepository = new ScheduleStatusUpdaterRepository(
      withRows.db as never
    );
    const withoutRepository = new ScheduleStatusUpdaterRepository(
      withoutRows.db as never
    );

    await expect(
      withRepository.updateScheduleStatusIfCurrent(
        'sch-1',
        EScheduleStatus.processing,
        [EScheduleStatus.pending]
      )
    ).resolves.toBe(true);

    await expect(
      withoutRepository.updateScheduleStatusIfCurrent(
        'sch-1',
        EScheduleStatus.processing,
        [EScheduleStatus.pending]
      )
    ).resolves.toBe(false);
  });
});
