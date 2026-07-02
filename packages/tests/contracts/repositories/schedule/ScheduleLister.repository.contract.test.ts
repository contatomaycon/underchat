import 'reflect-metadata';
import { ESortOrder } from '@core/common/enums/ESortOrder';
import { EScheduleSendTo } from '@core/common/enums/EScheduleSendTo';
import { EScheduleType } from '@core/common/enums/EScheduleType';
import { ScheduleListerRepository } from '@core/repositories/schedule/ScheduleLister.repository';
import { createSelectDbMock } from '@core/tests/helpers/drizzleMock';

describe('ScheduleListerRepository', () => {
  it('setOrders returns default when sort is empty', () => {
    const repository = new ScheduleListerRepository({} as never);

    const result = (repository as any).setOrders({});

    expect(result).toHaveLength(1);
  });

  it('setOrders supports send_date and created_at keys', () => {
    const repository = new ScheduleListerRepository({} as never);

    const result = (repository as any).setOrders({
      sort_by: [
        { key: 'send_date', order: ESortOrder.asc },
        { key: 'created_at', order: ESortOrder.desc },
      ],
    });

    expect(result).toHaveLength(2);
  });

  it('setFilters appends search, type and send_to filters', () => {
    const repository = new ScheduleListerRepository({} as never);

    const result = (repository as any).setFilters({
      search: 'promo',
      type: EScheduleType.text,
      send_to: EScheduleSendTo.contacts,
    });

    expect(result).toHaveLength(3);
  });

  it('listSchedules returns empty list when query has no rows', async () => {
    const { db } = createSelectDbMock([]);
    const repository = new ScheduleListerRepository(db as never);

    await expect(repository.listSchedules(10, 1, {}, 'acc-1')).resolves.toEqual(
      []
    );
  });

  it('listSchedules maps nullable fields to response defaults', async () => {
    const row = {
      schedule_id: 'sch-1',
      account: null,
      worker: null,
      type: EScheduleType.text,
      send_to: EScheduleSendTo.contacts,
      send_speed: 'low',
      chatbot_id: null,
      chatbot_name: null,
      message: null,
      url: null,
      mimetype: null,
      duration: null,
      width: null,
      height: null,
      official_template: null,
      send_date: '2026-04-21T22:00:00.000Z',
      status: 'pending',
      created_at: null,
    };
    const { db } = createSelectDbMock([row]);
    const repository = new ScheduleListerRepository(db as never);

    await expect(repository.listSchedules(10, 1, {}, 'acc-1')).resolves.toEqual(
      [
        {
          ...row,
          account: {
            account_id: '',
            name: '',
          },
          worker: {
            worker_id: '',
            name: '',
          },
        },
      ]
    );
  });

  it('listScheduleTotal returns count and fallback zero', async () => {
    const withCount = createSelectDbMock([{ count: 2 }]);
    const withoutCount = createSelectDbMock([]);

    const withCountRepository = new ScheduleListerRepository(
      withCount.db as never
    );
    const withoutCountRepository = new ScheduleListerRepository(
      withoutCount.db as never
    );

    await expect(
      withCountRepository.listScheduleTotal({}, 'acc-1')
    ).resolves.toBe(2);
    await expect(
      withoutCountRepository.listScheduleTotal({}, 'acc-1')
    ).resolves.toBe(0);
  });
});
