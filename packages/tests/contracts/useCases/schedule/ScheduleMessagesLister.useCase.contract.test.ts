import 'reflect-metadata';

import { ScheduleMessagesListerUseCase } from '@core/useCases/schedule/ScheduleMessagesLister.useCase';

const t = ((key: string) => key) as never;

describe('ScheduleMessagesListerUseCase', () => {
  it('blocks reading schedule messages outside the user channel scope before Elasticsearch', async () => {
    const scheduleMessagesListerRepository = {
      listScheduleMessages: jest.fn(async () => [[], 0]),
    };
    const scheduleService = {
      findScheduleControlById: jest.fn(async () => ({
        schedule_id: 'schedule-1',
        account_id: 'account-1',
        worker_id: 'worker-blocked',
      })),
    };
    const useCase = new ScheduleMessagesListerUseCase(
      scheduleMessagesListerRepository as never,
      scheduleService as never
    );

    await expect(
      useCase.execute(t, { schedule_id: 'schedule-1' } as never, 'account-1', [
        { id: 'worker-allowed', name: 'Allowed' },
      ])
    ).rejects.toThrow('chat_access_denied');

    expect(
      scheduleMessagesListerRepository.listScheduleMessages
    ).not.toHaveBeenCalled();
  });
});
