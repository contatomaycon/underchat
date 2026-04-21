import 'reflect-metadata';
import { currentTime } from '@core/common/functions/currentTime';
import { EScheduleStatus } from '@core/common/enums/EScheduleStatus';
import { ScheduleControlRepository } from '@core/repositories/schedule/ScheduleControl.repository';
import {
  createSelectDbMock,
  createUpdateDbMock,
} from '@core/tests/helpers/drizzleMock';

jest.mock('@core/common/functions/currentTime', () => ({
  currentTime: jest.fn(),
}));

describe('ScheduleControlRepository', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (currentTime as unknown as jest.Mock).mockReturnValue(
      '2026-04-21T21:00:00.000Z'
    );
  });

  it('findByIdAndAccount returns null when schedule is not found', async () => {
    const ro = createSelectDbMock([]).db;
    const repository = new ScheduleControlRepository(ro as never, {} as never);

    await expect(
      repository.findByIdAndAccount('sch-1', 'acc-1')
    ).resolves.toBeNull();
  });

  it('findByIdAndAccount returns schedule data when found', async () => {
    const ro = createSelectDbMock([
      {
        schedule_id: 'sch-1',
        account_id: 'acc-1',
        status: EScheduleStatus.pending,
        send_date: '2026-04-21T22:00:00.000Z',
      },
    ]).db;
    const repository = new ScheduleControlRepository(ro as never, {} as never);

    await expect(
      repository.findByIdAndAccount('sch-1', 'acc-1')
    ).resolves.toEqual({
      schedule_id: 'sch-1',
      account_id: 'acc-1',
      status: EScheduleStatus.pending,
      send_date: '2026-04-21T22:00:00.000Z',
    });
  });

  it('getScheduleStatusById returns status or null', async () => {
    const roWith = createSelectDbMock([
      { status: EScheduleStatus.processing },
    ]).db;
    const roWithout = createSelectDbMock([]).db;

    const withRepository = new ScheduleControlRepository(
      roWith as never,
      {} as never
    );
    const withoutRepository = new ScheduleControlRepository(
      roWithout as never,
      {} as never
    );

    await expect(withRepository.getScheduleStatusById('sch-1')).resolves.toBe(
      EScheduleStatus.processing
    );
    await expect(
      withoutRepository.getScheduleStatusById('sch-1')
    ).resolves.toBe(null);
  });

  it('startScheduleNow updates schedule and returns based on rowCount', async () => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-04-21T21:10:00.000Z'));

    const withRows = createUpdateDbMock({ rowCount: 1 });
    const withoutRows = createUpdateDbMock({ rowCount: 0 });

    const withRepository = new ScheduleControlRepository(
      {} as never,
      withRows.db as never
    );
    const withoutRepository = new ScheduleControlRepository(
      {} as never,
      withoutRows.db as never
    );

    await expect(withRepository.startScheduleNow('sch-1')).resolves.toBe(true);
    expect(withRows.set).toHaveBeenCalledWith({
      status: EScheduleStatus.processing,
      send_date: '2026-04-21T21:10:00.000Z',
      updated_at: '2026-04-21T21:00:00.000Z',
    });

    await expect(withoutRepository.startScheduleNow('sch-1')).resolves.toBe(
      false
    );

    jest.useRealTimers();
  });

  it('pauseSchedule and cancelSchedule return based on rowCount', async () => {
    const pause = createUpdateDbMock({ rowCount: 1 });
    const cancel = createUpdateDbMock({ rowCount: 0 });

    const pauseRepository = new ScheduleControlRepository(
      {} as never,
      pause.db as never
    );
    const cancelRepository = new ScheduleControlRepository(
      {} as never,
      cancel.db as never
    );

    await expect(pauseRepository.pauseSchedule('sch-1')).resolves.toBe(true);
    await expect(cancelRepository.cancelSchedule('sch-1')).resolves.toBe(false);
  });
});
