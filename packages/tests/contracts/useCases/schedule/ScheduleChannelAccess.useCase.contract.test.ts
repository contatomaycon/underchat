import 'reflect-metadata';
import { ScheduleCreatorUseCase } from '@core/useCases/schedule/ScheduleCreator.useCase';
import { ScheduleUpdaterUseCase } from '@core/useCases/schedule/ScheduleUpdater.useCase';

const t = ((key: string) => key) as never;

describe('schedule channel access', () => {
  it('blocks schedule creation before any channel work when the worker is outside the user scope', async () => {
    const scheduleService = {
      createSchedule: jest.fn(async () => 'schedule-1'),
      existsChatbotInAccount: jest.fn(async () => true),
    };
    const accountService = {
      existsAccountById: jest.fn(async () => true),
    };
    const workerService = {
      existsWorkerById: jest.fn(async () => true),
    };
    const storageService = {};
    const converterService = {};
    const scheduleOfficialMessageService = {
      isOfficialWorker: jest.fn(async () => false),
    };
    const useCase = new ScheduleCreatorUseCase(
      scheduleService as never,
      accountService as never,
      workerService as never,
      storageService as never,
      converterService as never,
      scheduleOfficialMessageService as never
    );

    await expect(
      useCase.execute(
        t,
        {
          worker_id: 'worker-blocked',
          send_date: '2099-01-01 12:00',
          type: 'text',
          send_to: 'all',
          send_speed: 'low',
          message: 'Hello',
        } as never,
        'account-1',
        [{ id: 'worker-allowed', name: 'Allowed' }]
      )
    ).rejects.toThrow('chat_access_denied');

    expect(
      scheduleOfficialMessageService.isOfficialWorker
    ).not.toHaveBeenCalled();
    expect(scheduleService.createSchedule).not.toHaveBeenCalled();
  });

  it('blocks changing an existing schedule to a worker outside the user scope', async () => {
    const scheduleService = {
      existsScheduleById: jest.fn(async () => true),
      viewScheduleById: jest.fn(async () => ({
        schedule_id: 'schedule-1',
        account: { account_id: 'account-1', name: 'Account' },
        worker: { worker_id: 'worker-allowed', name: 'Allowed' },
        type: 'text',
        send_to: 'all',
        send_speed: 'low',
        chatbot_id: null,
        official_template: null,
      })),
      updateScheduleById: jest.fn(async () => true),
      existsChatbotInAccount: jest.fn(async () => true),
    };
    const workerService = {
      existsWorkerById: jest.fn(async () => true),
    };
    const storageService = {
      uploadImage: jest.fn(async () => ({
        url: 'https://files.invalid/image',
      })),
    };
    const converterService = {};
    const scheduleOfficialMessageService = {
      isOfficialWorker: jest.fn(async () => false),
    };
    const useCase = new ScheduleUpdaterUseCase(
      scheduleService as never,
      workerService as never,
      storageService as never,
      converterService as never,
      scheduleOfficialMessageService as never
    );

    await expect(
      useCase.execute(
        t,
        'schedule-1',
        {
          worker_id: 'worker-blocked',
          type: 'image',
          url: {
            filename: 'image.png',
            toBuffer: jest.fn(async () => Buffer.from('image')),
          },
        } as never,
        'account-1',
        [{ id: 'worker-allowed', name: 'Allowed' }]
      )
    ).rejects.toThrow('chat_access_denied');

    expect(scheduleService.updateScheduleById).not.toHaveBeenCalled();
    expect(storageService.uploadImage).not.toHaveBeenCalled();
  });
});
