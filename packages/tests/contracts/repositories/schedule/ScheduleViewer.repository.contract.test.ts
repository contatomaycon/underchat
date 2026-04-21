import 'reflect-metadata';
import { ScheduleViewerRepository } from '@core/repositories/schedule/ScheduleViewer.repository';

function createSelectStep(result: unknown[]) {
  const execute = jest.fn(async () => result);
  const chain: {
    leftJoin: jest.Mock;
    where: jest.Mock;
  } = {
    leftJoin: jest.fn(),
    where: jest.fn(),
  };

  chain.where.mockReturnValue({ execute });
  chain.leftJoin.mockReturnValue(chain);
  const from = jest.fn(() => chain);

  return { from };
}

describe('ScheduleViewerRepository', () => {
  it('returns null when schedule is not found', async () => {
    const select = jest.fn(() => createSelectStep([]));
    const repository = new ScheduleViewerRepository({ select } as never);

    await expect(repository.viewScheduleById('sch-1')).resolves.toBeNull();
  });

  it('returns schedule with contacts and contact groups when found', async () => {
    const scheduleData = [
      {
        schedule_id: 'sch-1',
        account: {
          account_id: 'acc-1',
          name: 'Account 1',
        },
        worker: {
          worker_id: 'wk-1',
          name: 'Worker 1',
        },
        type: 'text',
        send_to: 'contacts',
        send_speed: 'low',
        chatbot_id: null,
        message: 'hello',
        url: null,
        mimetype: null,
        duration: null,
        width: null,
        height: null,
        send_date: '2026-04-21T22:00:00.000Z',
        created_at: '2026-04-21T10:00:00.000Z',
        updated_at: '2026-04-21T10:10:00.000Z',
      },
    ];

    const scheduledContactsData = [
      {
        contact_id: 'ct-1',
        contact_name: 'John',
        contact_phone_partial: '***9999',
        contact_group_id: null,
        contact_group_name: null,
      },
      {
        contact_id: null,
        contact_name: null,
        contact_phone_partial: null,
        contact_group_id: 'cg-1',
        contact_group_name: 'VIP',
      },
    ];

    const select = jest
      .fn()
      .mockReturnValueOnce(createSelectStep(scheduleData))
      .mockReturnValueOnce(createSelectStep(scheduledContactsData));

    const repository = new ScheduleViewerRepository({ select } as never);

    await expect(repository.viewScheduleById('sch-1')).resolves.toEqual({
      schedule_id: 'sch-1',
      account: {
        account_id: 'acc-1',
        name: 'Account 1',
      },
      worker: {
        worker_id: 'wk-1',
        name: 'Worker 1',
      },
      type: 'text',
      send_to: 'contacts',
      send_speed: 'low',
      chatbot_id: null,
      message: 'hello',
      url: null,
      mimetype: null,
      duration: null,
      width: null,
      height: null,
      send_date: '2026-04-21T22:00:00.000Z',
      contacts: [
        {
          contact_id: 'ct-1',
          name: 'John',
          phone_partial: '***9999',
        },
      ],
      contact_groups: [
        {
          contact_group_id: 'cg-1',
          name: 'VIP',
        },
      ],
      created_at: '2026-04-21T10:00:00.000Z',
      updated_at: '2026-04-21T10:10:00.000Z',
    });
  });
});
