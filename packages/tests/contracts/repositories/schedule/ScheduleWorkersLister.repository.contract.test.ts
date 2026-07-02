import 'reflect-metadata';
import { ScheduleWorkersListerRepository } from '@core/repositories/schedule/ScheduleWorkersLister.repository';
import { createSelectDbMock } from '@core/tests/helpers/drizzleMock';
import { EWorkerType } from '@core/common/enums/EWorkerType';

describe('ScheduleWorkersListerRepository', () => {
  it('returns empty array when query has no rows', async () => {
    const { db } = createSelectDbMock([]);
    const repository = new ScheduleWorkersListerRepository(db as never);

    await expect(repository.listScheduleWorkers('acc-1')).resolves.toEqual([]);
  });

  it('returns workers rows when query has results', async () => {
    const rows = [
      {
        worker_id: 'wk-1',
        name: 'Worker 1',
        number: '5511999999999',
        type_id: EWorkerType.whatsapp,
      },
    ];
    const { db } = createSelectDbMock(rows);
    const repository = new ScheduleWorkersListerRepository(db as never);

    await expect(repository.listScheduleWorkers('acc-1')).resolves.toEqual([
      {
        ...rows[0],
        is_official: true,
      },
    ]);
  });
});
