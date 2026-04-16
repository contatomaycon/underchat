import { inject, injectable } from 'tsyringe';
import {
  CreateS3BackupUploadInput,
  S3BackupUploadRepository,
} from '@core/repositories/s3BackupUpload/S3BackupUpload.repository';
import { ListS3BackupUploadsRequest } from '@core/schema/config/listS3BackupUploads/request.schema';
import { ListS3BackupUploadsResponse } from '@core/schema/config/listS3BackupUploads/response.schema';

@injectable()
export class S3BackupUploadService {
  constructor(
    @inject(S3BackupUploadRepository)
    private readonly s3BackupUploadRepository: S3BackupUploadRepository
  ) {}

  registerFallbackUpload = async (
    input: CreateS3BackupUploadInput
  ): Promise<void> => {
    await this.s3BackupUploadRepository.createFallbackUpload(input);
  };

  listUploads = async (
    perPage: number,
    currentPage: number,
    query: ListS3BackupUploadsRequest
  ): Promise<[ListS3BackupUploadsResponse[], number]> => {
    const [result, total] = await Promise.all([
      this.s3BackupUploadRepository.listS3BackupUploads(
        perPage,
        currentPage,
        query
      ),
      this.s3BackupUploadRepository.listS3BackupUploadsTotal(query),
    ]);

    return [result, total];
  };

  requestReprocess = async (s3BackupUploadId: string): Promise<boolean> => {
    return this.s3BackupUploadRepository.markReprocessRequested(
      s3BackupUploadId
    );
  };
}
