import 'reflect-metadata';
import { ScheduleDeleterRepository } from '@core/repositories/schedule/ScheduleDeleter.repository';

function createDeleteStep(rowCount: number) {
  const execute = jest.fn(async () => ({ rowCount }));
  const where = jest.fn(() => ({ execute }));
  return { where };
}

describe('ScheduleDeleterRepository', () => {
  it('returns true when schedule row is deleted', async () => {
    const deleteContacts = createDeleteStep(2);
    const deleteSchedule = createDeleteStep(1);

    const del = jest
      .fn()
      .mockReturnValueOnce({ where: deleteContacts.where })
      .mockReturnValueOnce({ where: deleteSchedule.where });

    const repository = new ScheduleDeleterRepository({
      transaction: jest.fn(async (cb: (tx: unknown) => Promise<unknown>) =>
        cb({ delete: del })
      ),
    } as never);

    await expect(repository.deleteScheduleById('sch-1')).resolves.toBe(true);
  });

  it('returns false when schedule row is not deleted', async () => {
    const deleteContacts = createDeleteStep(2);
    const deleteSchedule = createDeleteStep(0);

    const del = jest
      .fn()
      .mockReturnValueOnce({ where: deleteContacts.where })
      .mockReturnValueOnce({ where: deleteSchedule.where });

    const repository = new ScheduleDeleterRepository({
      transaction: jest.fn(async (cb: (tx: unknown) => Promise<unknown>) =>
        cb({ delete: del })
      ),
    } as never);

    await expect(repository.deleteScheduleById('sch-1')).resolves.toBe(false);
  });
});
