import 'reflect-metadata';

jest.mock('@core/services/s3BackupUpload.service', () => ({
  S3BackupUploadService: class {},
}));
jest.mock('@core/services/s3BackupMigration.service', () => ({
  S3BackupMigrationService: class {},
}));

import { S3BackupUploadReprocessorUseCase } from '@core/useCases/config/S3BackupUploadReprocessor.useCase';

describe('S3BackupUploadReprocessorUseCase', () => {
  it('requests reprocess through upload service', async () => {
    const s3BackupUploadService = {
      requestReprocess: jest.fn(async () => true),
    };
    const s3BackupMigrationService = {
      reprocessById: jest.fn(),
    };
    const useCase = new S3BackupUploadReprocessorUseCase(
      s3BackupUploadService as never,
      s3BackupMigrationService as never
    );

    await expect(useCase.requestReprocess('upload-1')).resolves.toBe(true);
    expect(s3BackupUploadService.requestReprocess).toHaveBeenCalledWith(
      'upload-1'
    );
  });

  it('executes immediate reprocess through migration service', async () => {
    const s3BackupUploadService = {
      requestReprocess: jest.fn(),
    };
    const s3BackupMigrationService = {
      reprocessById: jest.fn(async () => true),
    };
    const useCase = new S3BackupUploadReprocessorUseCase(
      s3BackupUploadService as never,
      s3BackupMigrationService as never
    );

    await expect(useCase.executeNow('upload-1')).resolves.toBe(true);
    expect(s3BackupMigrationService.reprocessById).toHaveBeenCalledWith(
      'upload-1'
    );
  });
});
