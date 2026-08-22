import 'reflect-metadata';
import { ScheduleWorkersListerUseCase } from '@core/useCases/schedule/ScheduleWorkersLister.useCase';

describe('ScheduleWorkersListerUseCase', () => {
  const workers = [
    {
      worker_id: 'worker-1',
      name: 'Support',
      number: '5511999990001',
      type_id: 'whatsapp',
      is_official: true,
    },
    {
      worker_id: 'worker-2',
      name: 'Sales',
      number: '5511999990002',
      type_id: 'baileys',
      is_official: false,
    },
  ];

  function makeUseCase() {
    const scheduleService = {
      listScheduleWorkers: jest.fn(async () => workers),
    };

    return {
      scheduleService,
      useCase: new ScheduleWorkersListerUseCase(scheduleService as never),
    };
  }

  it('returns every worker when the user has no channel restriction', async () => {
    const { useCase, scheduleService } = makeUseCase();

    await expect(useCase.execute('account-1')).resolves.toEqual(workers);
    expect(scheduleService.listScheduleWorkers).toHaveBeenCalledWith(
      'account-1'
    );
  });

  it('only returns workers assigned to the restricted user', async () => {
    const { useCase } = makeUseCase();

    await expect(
      useCase.execute('account-1', [{ id: 'worker-2', name: 'Sales' }])
    ).resolves.toEqual([workers[1]]);
  });
});
