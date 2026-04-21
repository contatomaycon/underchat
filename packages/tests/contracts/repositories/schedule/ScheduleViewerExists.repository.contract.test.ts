import 'reflect-metadata';
import { ScheduleViewerExistsRepository } from '@core/repositories/schedule/ScheduleViewerExists.repository';
import { createSelectDbMock } from '@core/tests/helpers/drizzleMock';

describe('ScheduleViewerExistsRepository', () => {
  it('returns false when schedule does not exist', async () => {
    const { db } = createSelectDbMock([]);
    const repository = new ScheduleViewerExistsRepository(db as never);

    await expect(repository.existsScheduleById('sch-1')).resolves.toBe(false);
  });

  it('returns true when schedule exists', async () => {
    const { db } = createSelectDbMock([{ schedule_id: 'sch-1' }]);
    const repository = new ScheduleViewerExistsRepository(db as never);

    await expect(repository.existsScheduleById('sch-1')).resolves.toBe(true);
  });
});
