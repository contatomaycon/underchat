import 'reflect-metadata';
import { ScheduleContactGroupsListerRepository } from '@core/repositories/schedule/ScheduleContactGroupsLister.repository';
import { createSelectDbMock } from '@core/tests/helpers/drizzleMock';

describe('ScheduleContactGroupsListerRepository', () => {
  it('returns empty array when query has no rows', async () => {
    const { db } = createSelectDbMock([]);
    const repository = new ScheduleContactGroupsListerRepository(db as never);

    await expect(
      repository.listScheduleContactGroups('acc-1')
    ).resolves.toEqual([]);
  });

  it('returns contact groups rows when query has results', async () => {
    const rows = [
      {
        contact_group_id: 'cg-1',
        name: 'VIP',
      },
    ];
    const { db } = createSelectDbMock(rows);
    const repository = new ScheduleContactGroupsListerRepository(db as never);

    await expect(
      repository.listScheduleContactGroups('acc-1')
    ).resolves.toEqual(rows);
  });
});
