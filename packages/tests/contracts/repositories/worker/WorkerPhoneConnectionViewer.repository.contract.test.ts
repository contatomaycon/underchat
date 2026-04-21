import 'reflect-metadata';
import { WorkerPhoneConnectionViewerRepository } from '@core/repositories/worker/WorkerPhoneConnectionViewer.repository';
import { createSelectDbMock } from '../../../helpers/drizzleMock';

describe('WorkerPhoneConnectionViewerRepository', () => {
  it('viewWorkerPhoneConnection returns null when no rows are found', async () => {
    const dbMock = createSelectDbMock([]);
    const repository = new WorkerPhoneConnectionViewerRepository(
      dbMock.db as never
    );

    await expect(
      repository.viewWorkerPhoneConnection('5511999999999')
    ).resolves.toBeNull();
  });

  it('viewWorkerPhoneConnection returns first row when found', async () => {
    const row = {
      worker_phone_connection_id: 'wpc-1',
      worker_id: 'w-1',
      number: '5511999999999',
      attempt: 1,
      date_attempt: '2026-04-21T10:00:00.000Z',
    };
    const dbMock = createSelectDbMock([row]);
    const repository = new WorkerPhoneConnectionViewerRepository(
      dbMock.db as never
    );

    await expect(
      repository.viewWorkerPhoneConnection('5511999999999')
    ).resolves.toEqual(row);
  });

  it('totalWorkerPhoneConnection returns count or zero', async () => {
    const select = jest
      .fn()
      .mockImplementationOnce(() => ({
        from: jest.fn(() => ({
          where: jest.fn(() => ({
            execute: jest.fn(async () => [{ total: 2 }]),
          })),
        })),
      }))
      .mockImplementationOnce(() => ({
        from: jest.fn(() => ({
          where: jest.fn(() => ({
            execute: jest.fn(async () => []),
          })),
        })),
      }));

    const repository = new WorkerPhoneConnectionViewerRepository({
      select,
    } as never);

    await expect(
      repository.totalWorkerPhoneConnection('5511999999999')
    ).resolves.toBe(2);
    await expect(
      repository.totalWorkerPhoneConnection('5511999999999')
    ).resolves.toBe(0);
  });
});
