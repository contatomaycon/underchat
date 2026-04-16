import { EHTTPStatusCode } from '@core/common/enums/EHTTPStatusCode';
import { sendResponse } from '@core/common/functions/sendResponse';
import { handleControllerError } from '@core/common/functions/handleControllerError';
import { FastifyReply, FastifyRequest } from 'fastify';
import { container } from 'tsyringe';
import { ReprocessS3BackupUploadRequest } from '@core/schema/config/reprocessS3BackupUpload/request.schema';
import { S3BackupUploadReprocessorUseCase } from '@core/useCases/config/S3BackupUploadReprocessor.useCase';

export const reprocessS3BackupUpload = async (
  request: FastifyRequest<{
    Params: ReprocessS3BackupUploadRequest;
  }>,
  reply: FastifyReply
) => {
  const s3BackupUploadReprocessorUseCase = container.resolve(
    S3BackupUploadReprocessorUseCase
  );
  const { t } = request;
  const s3BackupUploadId = request.params.s3_backup_upload_id;

  try {
    const requested =
      await s3BackupUploadReprocessorUseCase.requestReprocess(s3BackupUploadId);

    if (!requested) {
      return sendResponse(reply, {
        message: t('s3_backup_upload_not_found'),
        httpStatusCode: EHTTPStatusCode.bad_request,
      });
    }

    setImmediate(async () => {
      try {
        await s3BackupUploadReprocessorUseCase.executeNow(s3BackupUploadId);
      } catch (error) {
        console.error(
          'Error reprocessing S3 backup upload in background:',
          error
        );
      }
    });

    return sendResponse(reply, {
      message: t('s3_backup_upload_reprocess_enqueued'),
      httpStatusCode: EHTTPStatusCode.accepted,
    });
  } catch (error) {
    handleControllerError(error, reply, t);
  }
};
