import 'reflect-metadata';

jest.mock('@core/services/notificationMessage.service', () => ({
  NotificationMessageService: class {},
}));
jest.mock('@core/common/vendors/nodeRdkafka', () => ({
  rdkafka: {},
}));

import { PlanExpirationReminderService } from '@core/services/planExpirationReminder.service';
import { ENotificationTypeId } from '@core/common/enums/ENotificationType';

describe('PlanExpirationReminderService', () => {
  it('sends reminders, chooses notification type and marks cache', async () => {
    const findPlansExpiringInDays = jest
      .fn<
        Promise<
          Array<{
            account_id: string;
            plan_account_id: string;
            plan_id: string;
          }>
        >,
        [number]
      >()
      .mockImplementation(async (days) => {
        if (days === 3) {
          return [
            {
              account_id: 'a1',
              plan_account_id: 'pa1',
              plan_id: 'plan_regular',
            },
          ];
        }
        return [
          { account_id: 'a2', plan_account_id: 'pa2', plan_id: 'plan_test' },
        ];
      });

    const sendPlanNotification = jest.fn(async () => undefined);
    const findPlanIsTestById = jest
      .fn<Promise<boolean>, [string]>()
      .mockImplementation(async (id) => id === 'plan_test');
    const get = jest.fn(async () => null);
    const setex = jest.fn(async () => 'OK');

    const service = new PlanExpirationReminderService(
      { findPlansExpiringInDays } as never,
      { sendPlanNotification } as never,
      { findPlanIsTestById } as never,
      { get, setex } as never
    );

    await expect(service.processExpirationReminders()).resolves.toBeUndefined();

    expect(sendPlanNotification).toHaveBeenCalledWith(
      'a1',
      'plan_regular',
      ENotificationTypeId.plan_expiration
    );
    expect(sendPlanNotification).toHaveBeenCalledWith(
      'a2',
      'plan_test',
      ENotificationTypeId.test_plan_expiration
    );
    expect(setex).toHaveBeenCalledWith(
      'plan-expiration-reminder:a1:pa1:3days',
      3 * 86400,
      '1'
    );
    expect(setex).toHaveBeenCalledWith(
      'plan-expiration-reminder:a2:pa2:0days',
      86400,
      '1'
    );
  });

  it('does not send notification when cache key already exists', async () => {
    const sendPlanNotification = jest.fn(async () => undefined);
    const service = new PlanExpirationReminderService(
      {
        findPlansExpiringInDays: jest.fn(async () => [
          { account_id: 'a1', plan_account_id: 'pa1', plan_id: 'plan_1' },
        ]),
      } as never,
      { sendPlanNotification } as never,
      { findPlanIsTestById: jest.fn(async () => false) } as never,
      { get: jest.fn(async () => '1'), setex: jest.fn() } as never
    );

    await expect(service.processExpirationReminders()).resolves.toBeUndefined();
    expect(sendPlanNotification).not.toHaveBeenCalled();
  });

  it('swallows notification sending errors and continues processing', async () => {
    const consoleErrorSpy = jest
      .spyOn(console, 'error')
      .mockImplementation(() => undefined);
    const service = new PlanExpirationReminderService(
      {
        findPlansExpiringInDays: jest.fn(async () => [
          { account_id: 'a1', plan_account_id: 'pa1', plan_id: 'plan_1' },
        ]),
      } as never,
      {
        sendPlanNotification: jest.fn(async () => {
          throw new Error('notify failed');
        }),
      } as never,
      { findPlanIsTestById: jest.fn(async () => false) } as never,
      { get: jest.fn(async () => null), setex: jest.fn() } as never
    );

    try {
      await expect(
        service.processExpirationReminders()
      ).resolves.toBeUndefined();
      expect(consoleErrorSpy).toHaveBeenCalledWith(
        'Erro ao enviar notificação de vencimento para account a1:',
        expect.any(Error)
      );
    } finally {
      consoleErrorSpy.mockRestore();
    }
  });

  it('rethrows when outer processing fails', async () => {
    const consoleErrorSpy = jest
      .spyOn(console, 'error')
      .mockImplementation(() => undefined);
    const service = new PlanExpirationReminderService(
      {
        findPlansExpiringInDays: jest.fn(async () => {
          throw new Error('repo fail');
        }),
      } as never,
      { sendPlanNotification: jest.fn() } as never,
      { findPlanIsTestById: jest.fn() } as never,
      { get: jest.fn(), setex: jest.fn() } as never
    );

    try {
      await expect(service.processExpirationReminders()).rejects.toThrow(
        'repo fail'
      );
      expect(consoleErrorSpy).toHaveBeenCalledWith(
        'Erro ao processar lembretes de vencimento:',
        expect.any(Error)
      );
    } finally {
      consoleErrorSpy.mockRestore();
    }
  });
});
