import 'reflect-metadata';
jest.mock('uuid', () => ({ v7: () => 'uuid-mock' }));
import { S3BackupUploadService } from '@core/services/s3BackupUpload.service';

describe('S3BackupUploadService', () => {
  it('delegates register/list/requestReprocess methods', async () => {
    const createFallbackUpload = jest.fn(async () => undefined);
    const listS3BackupUploads = jest.fn(async () => [
      { s3_backup_upload_id: 's1' },
    ]);
    const listS3BackupUploadsTotal = jest.fn(async () => 9);
    const markReprocessRequested = jest.fn(async () => true);

    const service = new S3BackupUploadService({
      createFallbackUpload,
      listS3BackupUploads,
      listS3BackupUploadsTotal,
      markReprocessRequested,
    } as never);

    await expect(
      service.registerFallbackUpload({} as never)
    ).resolves.toBeUndefined();
    await expect(service.listUploads(20, 1, {} as never)).resolves.toEqual([
      [{ s3_backup_upload_id: 's1' }],
      9,
    ]);
    await expect(service.requestReprocess('s1')).resolves.toBe(true);
  });
});
