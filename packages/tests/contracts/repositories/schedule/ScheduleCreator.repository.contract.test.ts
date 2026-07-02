import 'reflect-metadata';
import { EScheduleSendTo } from '@core/common/enums/EScheduleSendTo';
import { ScheduleCreatorRepository } from '@core/repositories/schedule/ScheduleCreator.repository';
import { v7 as uuidv7 } from 'uuid';

jest.mock('uuid', () => ({
  v7: jest.fn(),
}));

function createInsertMock(results: unknown[]) {
  const insert = jest.fn();
  const valuesMocks: jest.Mock[] = [];

  for (const result of results) {
    const execute = jest.fn(async () => result);
    const values = jest.fn(() => ({ execute }));
    valuesMocks.push(values);
    insert.mockReturnValueOnce({ values });
  }

  return { insert, valuesMocks };
}

describe('ScheduleCreatorRepository', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('returns null when schedule insertion fails', async () => {
    (uuidv7 as unknown as jest.Mock).mockReturnValue('sch-1');
    const { insert } = createInsertMock([null]);

    const repository = new ScheduleCreatorRepository({
      transaction: jest.fn(async (cb: (tx: unknown) => Promise<unknown>) =>
        cb({ insert })
      ),
    } as never);

    await expect(
      repository.createSchedule({
        account_id: 'acc-1',
        worker_id: 'wk-1',
        type: 'text',
        send_to: EScheduleSendTo.contacts,
        send_speed: 'low',
        message: 'hello',
        url: null,
        mimetype: null,
        duration: null,
        width: null,
        height: null,
        send_date: '2026-04-21T22:00:00.000Z',
        contact_ids: ['ct-1'],
      })
    ).resolves.toBeNull();
  });

  it('creates schedule and scheduled contacts when send_to is contacts', async () => {
    (uuidv7 as unknown as jest.Mock)
      .mockReturnValueOnce('sch-1')
      .mockReturnValueOnce('sc-1')
      .mockReturnValueOnce('sc-2');

    const { insert, valuesMocks } = createInsertMock([
      { rowCount: 1 },
      { rowCount: 2 },
    ]);

    const repository = new ScheduleCreatorRepository({
      transaction: jest.fn(async (cb: (tx: unknown) => Promise<unknown>) =>
        cb({ insert })
      ),
    } as never);

    await expect(
      repository.createSchedule({
        account_id: 'acc-1',
        worker_id: 'wk-1',
        type: 'text',
        send_to: EScheduleSendTo.contacts,
        send_speed: 'low',
        message: 'hello',
        url: null,
        mimetype: null,
        duration: null,
        width: null,
        height: null,
        send_date: '2026-04-21T22:00:00.000Z',
        contact_ids: ['ct-1', 'ct-2'],
      })
    ).resolves.toBe('sch-1');

    expect(valuesMocks[1]).toHaveBeenCalledWith([
      {
        scheduled_contact_id: 'sc-1',
        schedule_id: 'sch-1',
        contact_id: 'ct-1',
        contact_group_id: null,
      },
      {
        scheduled_contact_id: 'sc-2',
        schedule_id: 'sch-1',
        contact_id: 'ct-2',
        contact_group_id: null,
      },
    ]);
  });

  it('creates schedule and scheduled contact groups when send_to is contact_groups', async () => {
    (uuidv7 as unknown as jest.Mock)
      .mockReturnValueOnce('sch-1')
      .mockReturnValueOnce('scg-1');

    const { insert, valuesMocks } = createInsertMock([
      { rowCount: 1 },
      { rowCount: 1 },
    ]);

    const repository = new ScheduleCreatorRepository({
      transaction: jest.fn(async (cb: (tx: unknown) => Promise<unknown>) =>
        cb({ insert })
      ),
    } as never);

    await expect(
      repository.createSchedule({
        account_id: 'acc-1',
        worker_id: 'wk-1',
        type: 'text',
        send_to: EScheduleSendTo.contact_groups,
        send_speed: 'low',
        message: 'hello',
        url: null,
        mimetype: null,
        duration: null,
        width: null,
        height: null,
        send_date: '2026-04-21T22:00:00.000Z',
        contact_group_ids: ['cg-1'],
      })
    ).resolves.toBe('sch-1');

    expect(valuesMocks[1]).toHaveBeenCalledWith([
      {
        scheduled_contact_id: 'scg-1',
        schedule_id: 'sch-1',
        contact_id: null,
        contact_group_id: 'cg-1',
      },
    ]);
  });

  it('persists official template payload on schedule creation', async () => {
    (uuidv7 as unknown as jest.Mock).mockReturnValueOnce('sch-1');
    const officialTemplate = {
      name: 'abertura',
      language: 'pt_BR',
      variables: [
        {
          key: 'BODY:1',
          component_type: 'BODY' as const,
          index: 1,
          value: '{{ name }}',
        },
      ],
    };

    const { insert, valuesMocks } = createInsertMock([{ rowCount: 1 }]);

    const repository = new ScheduleCreatorRepository({
      transaction: jest.fn(async (cb: (tx: unknown) => Promise<unknown>) =>
        cb({ insert })
      ),
    } as never);

    await expect(
      repository.createSchedule({
        account_id: 'acc-1',
        worker_id: 'wk-1',
        type: 'official_template',
        send_to: EScheduleSendTo.contacts,
        send_speed: 'low',
        chatbot_id: null,
        message: null,
        url: null,
        mimetype: null,
        duration: null,
        width: null,
        height: null,
        official_template: officialTemplate,
        send_date: '2026-04-21T22:00:00.000Z',
      })
    ).resolves.toBe('sch-1');

    expect(valuesMocks[0]).toHaveBeenCalledWith(
      expect.objectContaining({
        schedule_id: 'sch-1',
        type: 'official_template',
        official_template: officialTemplate,
      })
    );
  });
});
