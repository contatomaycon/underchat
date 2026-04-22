import 'reflect-metadata';

jest.mock('@core/services/s3BackupUpload.service', () => ({
  S3BackupUploadService: class {},
}));

import { S3BackupUploadsListerUseCase } from '@core/useCases/config/S3BackupUploadsLister.useCase';

describe('S3BackupUploadsListerUseCase', () => {
  it('uses default pagination values when query is empty', async () => {
    const s3BackupUploadService = {
      listUploads: jest.fn(async () => [[], 0]),
    };
    const useCase = new S3BackupUploadsListerUseCase(
      s3BackupUploadService as never
    );

    await expect(useCase.execute({} as never)).resolves.toEqual({
      pagings: {
        current_page: 1,
        total_pages: 0,
        per_page: 10,
        count: 0,
        total: 0,
      },
      results: [],
    });
    expect(s3BackupUploadService.listUploads).toHaveBeenCalledWith(10, 1, {});
  });

  it('returns paginated s3 backup uploads', async () => {
    const results = [{ s3_backup_upload_id: 'upload-1' }];
    const s3BackupUploadService = {
      listUploads: jest.fn(async () => [results, 5]),
    };
    const useCase = new S3BackupUploadsListerUseCase(
      s3BackupUploadService as never
    );

    await expect(
      useCase.execute({ per_page: 2, current_page: 2 } as never)
    ).resolves.toEqual({
      pagings: {
        current_page: 2,
        total_pages: 3,
        per_page: 2,
        count: 1,
        total: 5,
      },
      results,
    });
  });
});
