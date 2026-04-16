import { inject, injectable } from 'tsyringe';
import { S3BackupMigrationService } from '@core/services/s3BackupMigration.service';
import { S3BackupUploadService } from '@core/services/s3BackupUpload.service';

@injectable()
export class S3BackupUploadReprocessorUseCase {
  constructor(
    @inject(S3BackupUploadService)
    private readonly s3BackupUploadService: S3BackupUploadService,
    @inject(S3BackupMigrationService)
    private readonly s3BackupMigrationService: S3BackupMigrationService
  ) {}

  requestReprocess = async (s3BackupUploadId: string): Promise<boolean> => {
    return this.s3BackupUploadService.requestReprocess(s3BackupUploadId);
  };

  executeNow = async (s3BackupUploadId: string): Promise<boolean> => {
    return this.s3BackupMigrationService.reprocessById(s3BackupUploadId);
  };
}
