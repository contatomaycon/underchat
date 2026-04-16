import { inject, injectable } from 'tsyringe';
import { setPaginationData } from '@core/common/functions/createPaginationData';
import { S3BackupUploadService } from '@core/services/s3BackupUpload.service';
import { ListS3BackupUploadsRequest } from '@core/schema/config/listS3BackupUploads/request.schema';
import { ListS3BackupUploadsFinalResponse } from '@core/schema/config/listS3BackupUploads/response.schema';

@injectable()
export class S3BackupUploadsListerUseCase {
  constructor(
    @inject(S3BackupUploadService)
    private readonly s3BackupUploadService: S3BackupUploadService
  ) {}

  async execute(
    query: ListS3BackupUploadsRequest
  ): Promise<ListS3BackupUploadsFinalResponse> {
    const perPage = query.per_page ?? 10;
    const currentPage = query.current_page ?? 1;

    const [results, total] = await this.s3BackupUploadService.listUploads(
      perPage,
      currentPage,
      query
    );

    const pagings = setPaginationData(
      results.length,
      total,
      perPage,
      currentPage
    );

    return {
      pagings,
      results,
    };
  }
}
