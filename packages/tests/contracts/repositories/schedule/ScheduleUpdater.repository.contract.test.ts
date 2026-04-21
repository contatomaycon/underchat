import 'reflect-metadata';
import { currentTime } from '@core/common/functions/currentTime';
import { EScheduleSendSpeed } from '@core/common/enums/EScheduleSendSpeed';
import { EScheduleSendTo } from '@core/common/enums/EScheduleSendTo';
import { EScheduleType } from '@core/common/enums/EScheduleType';
import { ScheduleUpdaterRepository } from '@core/repositories/schedule/ScheduleUpdater.repository';
import { v7 as uuidv7 } from 'uuid';

jest.mock('uuid', () => ({
  v7: jest.fn(),
}));

jest.mock('@core/common/functions/currentTime', () => ({
  currentTime: jest.fn(),
}));

function createDeleteStep() {
  const execute = jest.fn(async () => ({ rowCount: 1 }));
  const where = jest.fn(() => ({ execute }));
  return { where };
}

function createInsertStep() {
  const execute = jest.fn(async () => ({ rowCount: 2 }));
  const values = jest.fn(() => ({ execute }));
  return { values };
}

function createUpdateStep(rowCount: number) {
  const execute = jest.fn(async () => ({ rowCount }));
  const where = jest.fn(() => ({ execute }));
  const set = jest.fn(() => ({ where }));
  return { set };
}

describe('ScheduleUpdaterRepository', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (currentTime as unknown as jest.Mock).mockReturnValue(
      '2026-04-21T21:30:00.000Z'
    );
  });

  it('prepareUpdateData includes only provided fields and updated_at', () => {
    const repository = new ScheduleUpdaterRepository({} as never);

    const result = (repository as any).prepareUpdateData({
      worker_id: 'wk-1',
      type: EScheduleType.text,
      send_to: EScheduleSendTo.contacts,
      send_speed: EScheduleSendSpeed.medium,
      chatbot_id: null,
      message: 'hello',
      send_date: '2026-04-21T22:00:00.000Z',
    });

    expect(result).toEqual({
      updated_at: '2026-04-21T21:30:00.000Z',
      worker_id: 'wk-1',
      type: EScheduleType.text,
      send_to: EScheduleSendTo.contacts,
      send_speed: EScheduleSendSpeed.medium,
      chatbot_id: null,
      message: 'hello',
      send_date: '2026-04-21T22:00:00.000Z',
    });
  });

  it('updateScheduleById creates scheduled contacts when send_to is contacts', async () => {
    (uuidv7 as unknown as jest.Mock)
      .mockReturnValueOnce('sc-1')
      .mockReturnValueOnce('sc-2');

    const deleteStep = createDeleteStep();
    const insertStep = createInsertStep();
    const updateStep = createUpdateStep(1);

    const repository = new ScheduleUpdaterRepository({
      transaction: jest.fn(async (cb: (tx: unknown) => Promise<unknown>) =>
        cb({
          delete: jest.fn(() => ({ where: deleteStep.where })),
          insert: jest.fn(() => ({ values: insertStep.values })),
          update: jest.fn(() => ({ set: updateStep.set })),
        })
      ),
    } as never);

    await expect(
      repository.updateScheduleById('sch-1', {
        send_to: EScheduleSendTo.contacts,
        contact_ids: ['ct-1', 'ct-2'],
      } as never)
    ).resolves.toBe(true);

    expect(insertStep.values).toHaveBeenCalledWith([
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

  it('updateScheduleById creates scheduled contact groups when send_to is contact_groups', async () => {
    (uuidv7 as unknown as jest.Mock).mockReturnValueOnce('scg-1');

    const deleteStep = createDeleteStep();
    const insertStep = createInsertStep();
    const updateStep = createUpdateStep(1);

    const repository = new ScheduleUpdaterRepository({
      transaction: jest.fn(async (cb: (tx: unknown) => Promise<unknown>) =>
        cb({
          delete: jest.fn(() => ({ where: deleteStep.where })),
          insert: jest.fn(() => ({ values: insertStep.values })),
          update: jest.fn(() => ({ set: updateStep.set })),
        })
      ),
    } as never);

    await expect(
      repository.updateScheduleById('sch-1', {
        send_to: EScheduleSendTo.contact_groups,
        contact_group_ids: ['cg-1'],
      } as never)
    ).resolves.toBe(true);

    expect(insertStep.values).toHaveBeenCalledWith([
      {
        scheduled_contact_id: 'scg-1',
        schedule_id: 'sch-1',
        contact_id: null,
        contact_group_id: 'cg-1',
      },
    ]);
  });

  it('updateScheduleById returns false when update affects no rows', async () => {
    const deleteStep = createDeleteStep();
    const updateStep = createUpdateStep(0);

    const repository = new ScheduleUpdaterRepository({
      transaction: jest.fn(async (cb: (tx: unknown) => Promise<unknown>) =>
        cb({
          delete: jest.fn(() => ({ where: deleteStep.where })),
          insert: jest.fn(() => ({ values: jest.fn() })),
          update: jest.fn(() => ({ set: updateStep.set })),
        })
      ),
    } as never);

    await expect(
      repository.updateScheduleById('sch-1', {} as never)
    ).resolves.toBe(false);
  });
});
