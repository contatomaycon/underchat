import 'reflect-metadata';
jest.mock('@core/common/vendors/nodeRdkafka', () => ({ rdkafka: {} }));
jest.mock('uuid', () => ({ v7: () => 'uuid-mock' }));
jest.mock(
  'file-type',
  () => ({
    fileTypeFromBuffer: jest.fn(async () => null),
  }),
  { virtual: true }
);
jest.mock('@core/services/balanceWorkerStatusGrpcClient.service', () => ({
  BalanceWorkerStatusGrpcClientService: class {},
}));

import { WorkerProfileInfoService } from '@core/services/workerProfileInfo.service';

describe('WorkerProfileInfoService', () => {
  const t = (key: string) => key;

  it('returns null when profile info does not exist and maps existing result', async () => {
    const viewWorkerProfileInfoByWorkerId = jest
      .fn<Promise<unknown>, unknown[]>()
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({
        worker_profile_info_id: 'wpi1',
        worker_id: 'w1',
        name: 'John',
        message: 'Hello',
        photo: 'url',
        created_at: '2026-01-01',
        updated_at: '2026-01-02',
      });

    const service = new WorkerProfileInfoService(
      { uploadImage: jest.fn() } as never,
      { viewWorkerProfileInfoByWorkerId } as never,
      { upsertWorkerProfileInfo: jest.fn() } as never
    );

    await expect(service.viewWorkerProfileInfo('w1')).resolves.toBeNull();
    await expect(service.viewWorkerProfileInfo('w1')).resolves.toEqual({
      worker_profile_info_id: 'wpi1',
      worker_id: 'w1',
      name: 'John',
      message: 'Hello',
      photo: 'url',
      created_at: '2026-01-01',
      updated_at: '2026-01-02',
    });
  });

  it('upserts data with removePhoto and upload flow', async () => {
    const upsertWorkerProfileInfo = jest.fn(async () => undefined);
    const uploadImage = jest
      .fn<Promise<{ url: string } | null>, unknown[]>()
      .mockResolvedValueOnce({ url: 'https://cdn/new.jpg' })
      .mockResolvedValueOnce(null);

    const viewWorkerProfileInfoByWorkerId = jest
      .fn<Promise<unknown>, unknown[]>()
      .mockResolvedValueOnce({
        worker_profile_info_id: 'wpi2',
        worker_id: 'w1',
        name: 'N',
        message: 'M',
        photo: 'https://cdn/new.jpg',
      })
      .mockResolvedValueOnce({
        worker_profile_info_id: 'wpi3',
        worker_id: 'w1',
        name: 'N2',
        message: 'M2',
        photo: null,
      })
      .mockResolvedValueOnce(null);

    const service = new WorkerProfileInfoService(
      { uploadImage } as never,
      { viewWorkerProfileInfoByWorkerId } as never,
      { upsertWorkerProfileInfo } as never
    );

    await expect(
      service.upsertWorkerProfileInfo(t as never, 'w1', 'a1', 'N', 'M', {
        file: 'x',
      } as never)
    ).resolves.toEqual(
      expect.objectContaining({
        worker_profile_info_id: 'wpi2',
        photo: 'https://cdn/new.jpg',
      })
    );

    await expect(
      service.upsertWorkerProfileInfo(
        t as never,
        'w1',
        'a1',
        'N2',
        'M2',
        null,
        true
      )
    ).resolves.toEqual(
      expect.objectContaining({ worker_profile_info_id: 'wpi3', photo: null })
    );

    await expect(
      service.upsertWorkerProfileInfo(t as never, 'w1', 'a1', 'N3', 'M3', {
        file: 'y',
      } as never)
    ).rejects.toThrow('profile_info_photo_upload_error');

    expect(upsertWorkerProfileInfo).toHaveBeenCalledWith(
      'w1',
      expect.objectContaining({
        name: 'N',
        message: 'M',
        photo: 'https://cdn/new.jpg',
      })
    );
    expect(upsertWorkerProfileInfo).toHaveBeenCalledWith(
      'w1',
      expect.objectContaining({ name: 'N2', message: 'M2', photo: null })
    );
  });

  it('throws when profile info cannot be loaded after upsert', async () => {
    const service = new WorkerProfileInfoService(
      { uploadImage: jest.fn(async () => ({ url: 'ok' })) } as never,
      { viewWorkerProfileInfoByWorkerId: jest.fn(async () => null) } as never,
      { upsertWorkerProfileInfo: jest.fn(async () => undefined) } as never
    );

    await expect(
      service.upsertWorkerProfileInfo(t as never, 'w1', 'a1', 'N', 'M', null)
    ).rejects.toThrow('profile_info_not_found');
  });
});
