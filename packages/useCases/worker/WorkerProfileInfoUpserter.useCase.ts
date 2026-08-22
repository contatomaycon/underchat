import { injectable, inject } from 'tsyringe';
import { TFunction } from 'i18next';
import { WorkerProfileInfoService } from '@core/services/workerProfileInfo.service';
import { WorkerService } from '@core/services/worker.service';
import { UploadProfileInfoResponse } from '@core/schema/worker/uploadProfileInfo/response.schema';
import { UploadProfileInfoRequest } from '@core/schema/worker/uploadProfileInfo/request.schema';
import { UploadFileRequest } from '@core/schema/upload/request.schema';
import { IProfileInfoMessage } from '@core/common/interfaces/IProfileInfoMessage';
import { isOfficialWhatsappWorker } from '@core/common/functions/workerOfficialCapabilities';
import { WorkerCommandAdmissionService } from '@core/services/workerCommandAdmission.service';

@injectable()
export class WorkerProfileInfoUpserterUseCase {
  MAX_FILE_SIZE_BYTES = 16 * 1024 * 1024;

  constructor(
    @inject(WorkerProfileInfoService)
    private readonly workerProfileInfoService: WorkerProfileInfoService,
    @inject(WorkerService)
    private readonly workerService: WorkerService,
    @inject(WorkerCommandAdmissionService)
    private readonly workerCommandAdmissionService: WorkerCommandAdmissionService
  ) {}

  private normalizeField(field: unknown): string | undefined {
    if (field === undefined || field === null) return undefined;
    if (typeof field === 'string') return field;
    if (typeof field === 'object' && field !== null && 'value' in field) {
      const value = (field as { value: unknown }).value;

      if (typeof value === 'string') return value;
      if (value === null || value === undefined) return undefined;
      if (typeof value === 'number' || typeof value === 'boolean') {
        return String(value);
      }

      return undefined;
    }

    if (typeof field === 'number' || typeof field === 'boolean') {
      return String(field);
    }

    return undefined;
  }

  private normalizeBooleanField(field: unknown): boolean {
    if (field === undefined || field === null) return false;
    if (typeof field === 'boolean') return field;
    if (typeof field === 'object' && field !== null && 'value' in field) {
      return this.normalizeBooleanField((field as { value: unknown }).value);
    }
    if (typeof field === 'string') {
      const normalized = field.trim().toLowerCase();
      if (['true', '1', 'yes', 'on'].includes(normalized)) {
        return true;
      }
      if (['false', '0', 'no', 'off'].includes(normalized)) {
        return false;
      }
    }

    return false;
  }

  private async validateFileSize(
    file: UploadFileRequest,
    t: TFunction<'translation', undefined>
  ): Promise<Buffer> {
    const buffer = await file.toBuffer();

    if (buffer.byteLength > this.MAX_FILE_SIZE_BYTES) {
      throw new Error(t('profile_info_file_size_exceeded', { max: '16 MB' }));
    }

    return buffer;
  }

  async execute(
    t: TFunction<'translation', undefined>,
    accountId: string,
    workerId: string,
    body: UploadProfileInfoRequest
  ): Promise<UploadProfileInfoResponse> {
    const worker = await this.workerService.viewWorker(accountId, workerId);

    if (!worker) {
      throw new Error(t('worker_not_found'));
    }

    if (isOfficialWhatsappWorker(worker.type?.id)) {
      throw new Error(t('whatsapp_official_profile_info_not_supported'));
    }

    const name = this.normalizeField(body.name);
    const message = this.normalizeField(body.message);
    const removePhoto = this.normalizeBooleanField(body.remove_photo);
    let photo: UploadFileRequest | null = null;

    if (body.photo && body.photo !== null && !removePhoto) {
      photo = body.photo;
      await this.validateFileSize(photo, t);
    }

    const result = await this.workerProfileInfoService.upsertWorkerProfileInfo(
      t,
      workerId,
      accountId,
      name || null,
      message || null,
      photo,
      removePhoto
    );

    if (!result) {
      throw new Error(t('profile_info_upload_error'));
    }

    const profileInfoMessage: IProfileInfoMessage = {
      worker_id: workerId,
      account_id: accountId,
      name: result.name,
      message: result.message,
      photo: result.photo,
    };

    await this.workerCommandAdmissionService.admit({
      accountId,
      workerId,
      commandType: 'provider_command',
      entityKey: `control:${accountId}:${workerId}:profile`,
      operationId: `profile-info:${result.updated_at ?? result.photo ?? result.name ?? result.message ?? 'update'}`,
      payload: profileInfoMessage as unknown as Record<string, never>,
      source: 'worker_profile_info',
    });

    return result;
  }
}
