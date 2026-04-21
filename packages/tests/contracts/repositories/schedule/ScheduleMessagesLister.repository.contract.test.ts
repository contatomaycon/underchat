import 'reflect-metadata';
import { ScheduleMessagesListerRepository } from '@core/repositories/schedule/ScheduleMessagesLister.repository';

describe('ScheduleMessagesListerRepository', () => {
  it('listScheduleMessages returns empty tuple when elastic select returns null', async () => {
    const repository = new ScheduleMessagesListerRepository({
      indices: jest.fn(async () => true),
      select: jest.fn(async () => null),
    } as never);

    await expect(
      repository.listScheduleMessages('sch-1', 'acc-1', 1, 10)
    ).resolves.toEqual([[], 0]);
  });

  it('listScheduleMessages returns messages and total when search succeeds', async () => {
    const repository = new ScheduleMessagesListerRepository({
      indices: jest.fn(async () => true),
      select: jest.fn(async () => ({
        hits: {
          total: {
            value: 3,
            relation: 'eq',
          },
          hits: [
            {
              _source: {
                schedule_id: 'sch-1',
                status: 'sent',
              },
            },
          ],
        },
      })),
    } as never);

    await expect(
      repository.listScheduleMessages('sch-1', 'acc-1', 1, 10)
    ).resolves.toEqual([[{ schedule_id: 'sch-1', status: 'sent' }], 3]);
  });

  it('countFailedMessagesByScheduleIds returns empty object for empty ids', async () => {
    const select = jest.fn();
    const repository = new ScheduleMessagesListerRepository({
      indices: jest.fn(),
      select,
    } as never);

    await expect(
      repository.countFailedMessagesByScheduleIds([], 'acc-1')
    ).resolves.toEqual({});

    expect(select).not.toHaveBeenCalled();
  });

  it('countFailedMessagesByScheduleIds returns empty object when elastic returns null', async () => {
    const repository = new ScheduleMessagesListerRepository({
      indices: jest.fn(async () => true),
      select: jest.fn(async () => null),
    } as never);

    await expect(
      repository.countFailedMessagesByScheduleIds(['sch-1'], 'acc-1')
    ).resolves.toEqual({});
  });

  it('countFailedMessagesByScheduleIds maps aggregation buckets by schedule id', async () => {
    const repository = new ScheduleMessagesListerRepository({
      indices: jest.fn(async () => true),
      select: jest.fn(async () => ({
        aggregations: {
          by_schedule: {
            buckets: [
              { key: 'sch-1', doc_count: 2 },
              { key: 'sch-2', doc_count: 5 },
            ],
          },
        },
      })),
    } as never);

    await expect(
      repository.countFailedMessagesByScheduleIds(['sch-1', 'sch-2'], 'acc-1')
    ).resolves.toEqual({
      'sch-1': 2,
      'sch-2': 5,
    });
  });
});
