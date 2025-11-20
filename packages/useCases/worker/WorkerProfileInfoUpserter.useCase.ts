import { injectable } from 'tsyringe';
import { TFunction } from 'i18next';
import { WorkerProfileInfoService } from '@core/services/workerProfileInfo.service';
import { UploadProfileInfoResponse } from '@core/schema/worker/uploadProfileInfo/response.schema';
import { UploadProfileInfoRequest } from '@core/schema/worker/uploadProfileInfo/request.schema';
import { UploadFileRequest } from '@core/schema/upload/request.schema';

@injectable()
export class WorkerProfileInfoUpserterUseCase {
  MAX_FILE_SIZE_BYTES = 16 * 1024 * 1024;

  constructor(
    private readonly workerProfileInfoService: WorkerProfileInfoService
  ) {}

  private normalizeField(field: unknown): string | undefined {
    if (field === undefined || field === null) return undefined;
    if (typeof field === 'string') return field;
    if (typeof field === 'object' && field !== null && 'value' in field) {
      return String((field as { value: unknown }).value);
    }

    return String(field);
  }

  private async validateFileSize(
    file: UploadFileRequest,
    t: TFunction<'translation', undefined>
  ): Promise<void> {
    const buffer = await file.toBuffer();

    if (buffer.byteLength > this.MAX_FILE_SIZE_BYTES) {
      throw new Error(t('profile_info_file_size_exceeded', { max: '16 MB' }));
    }
  }

  async execute(
    t: TFunction<'translation', undefined>,
    accountId: string,
    workerId: string,
    body: UploadProfileInfoRequest
  ): Promise<UploadProfileInfoResponse> {
    const name = this.normalizeField(body.name);
    const message = this.normalizeField(body.message);
    let photo: UploadFileRequest | null = null;

    if (body.photo && body.photo !== null) {
      photo = body.photo as UploadFileRequest;
      await this.validateFileSize(photo, t);
    }

    const result = await this.workerProfileInfoService.upsertWorkerProfileInfo(
      t,
      workerId,
      accountId,
      name || null,
      message || null,
      photo
    );

    if (!result) {
      throw new Error(t('profile_info_upload_error'));
    }

    return result;
  }
}
