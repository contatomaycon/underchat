import 'reflect-metadata';
import { WorkerUpdaterRepository } from '@core/repositories/worker/WorkerUpdater.repository';
import { currentTime } from '@core/common/functions/currentTime';

jest.mock('@core/common/functions/currentTime', () => ({
  currentTime: jest.fn(),
}));

describe('WorkerUpdaterRepository', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (currentTime as jest.Mock).mockReturnValue('2026-04-21T10:00:00.000Z');
  });

  it('updateInput maps optional fields including in-operator properties', () => {
    const repository = new WorkerUpdaterRepository({} as never);

    const payload = (repository as any).updateInput({
      worker_status_id: 'status-1',
      worker_type_id: 'type-1',
      server_id: 'server-1',
      name: 'Worker 1',
      number: null,
      container_id: 'container-1',
      connection_date: '2026-04-21T10:00:00.000Z',
      recreate_available_at: '2026-06-11T12:02:00.000Z',
      deleted_at: '2026-04-21T10:00:00.000Z',
    });

    expect(payload).toEqual({
      worker_status_id: 'status-1',
      worker_type_id: 'type-1',
      server_id: 'server-1',
      name: 'Worker 1',
      number: null,
      container_id: 'container-1',
      connection_date: '2026-04-21T10:00:00.000Z',
      recreate_available_at: '2026-06-11T12:02:00.000Z',
      deleted_at: '2026-04-21T10:00:00.000Z',
    });
  });

  it('returns false when there are no fields to update', async () => {
    const repository = new WorkerUpdaterRepository({} as never);

    await expect(
      repository.updateWorkerById('account-1', { worker_id: 'w-1' } as never)
    ).resolves.toBe(false);
  });

  it('returns true when update affects one row', async () => {
    const set = jest.fn(() => ({
      where: jest.fn(() => ({
        execute: jest.fn(async () => ({ rowCount: 1 })),
      })),
    }));
    const repository = new WorkerUpdaterRepository({
      update: jest.fn(() => ({ set })),
    } as never);

    await expect(
      repository.updateWorkerById('account-1', {
        worker_id: 'w-1',
        name: 'Worker 1',
      } as never)
    ).resolves.toBe(true);

    expect(set).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'Worker 1',
        updated_at: '2026-04-21T10:00:00.000Z',
      })
    );
  });

  it('returns false when update affects zero rows', async () => {
    const repository = new WorkerUpdaterRepository({
      update: jest.fn(() => ({
        set: jest.fn(() => ({
          where: jest.fn(() => ({
            execute: jest.fn(async () => ({ rowCount: 0 })),
          })),
        })),
      })),
    } as never);

    await expect(
      repository.updateWorkerById('account-1', {
        worker_id: 'w-1',
        name: 'Worker 1',
      } as never)
    ).resolves.toBe(false);
  });

  it('uses cooldown guard when updating recreate state', async () => {
    const execute = jest.fn(async () => ({ rowCount: 1 }));
    const where = jest.fn(() => ({ execute }));
    const set = jest.fn(() => ({ where }));
    const repository = new WorkerUpdaterRepository({
      update: jest.fn(() => ({ set })),
    } as never);

    await expect(
      repository.updateWorkerByIdIfRecreateAvailable(
        'account-1',
        {
          worker_id: 'w-1',
          recreate_available_at: '2026-06-11T12:02:00.000Z',
        } as never,
        '2026-06-11T12:00:00.000Z'
      )
    ).resolves.toBe(true);

    expect(set).toHaveBeenCalledWith(
      expect.objectContaining({
        recreate_available_at: '2026-06-11T12:02:00.000Z',
        updated_at: '2026-04-21T10:00:00.000Z',
      })
    );
    expect(where).toHaveBeenCalled();
  });

  it('returns false when cooldown guard update affects zero rows', async () => {
    const repository = new WorkerUpdaterRepository({
      update: jest.fn(() => ({
        set: jest.fn(() => ({
          where: jest.fn(() => ({
            execute: jest.fn(async () => ({ rowCount: 0 })),
          })),
        })),
      })),
    } as never);

    await expect(
      repository.updateWorkerByIdIfRecreateAvailable(
        'account-1',
        {
          worker_id: 'w-1',
          recreate_available_at: '2026-06-11T12:02:00.000Z',
        } as never,
        '2026-06-11T12:00:00.000Z'
      )
    ).resolves.toBe(false);
  });
});
