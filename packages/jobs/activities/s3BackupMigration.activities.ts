import { S3BackupMigrationService } from '@core/services/s3BackupMigration.service';
import { injectable, inject } from 'tsyringe';

export interface IS3BackupMigrationActivity {
  processPendingS3BackupUploads(): Promise<void>;
}

@injectable()
export class S3BackupMigrationActivity implements IS3BackupMigrationActivity {
  constructor(
    @inject(S3BackupMigrationService)
    private readonly s3BackupMigrationService: S3BackupMigrationService
  ) {}

  processPendingS3BackupUploads = async (): Promise<void> => {
    await this.s3BackupMigrationService.processPendingUploads();
  };
}
