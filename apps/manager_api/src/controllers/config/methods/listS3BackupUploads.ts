import { EHTTPStatusCode } from '@core/common/enums/EHTTPStatusCode';
import { sendResponse } from '@core/common/functions/sendResponse';
import { handleControllerError } from '@core/common/functions/handleControllerError';
import { FastifyReply, FastifyRequest } from 'fastify';
import { container } from 'tsyringe';
import { ListS3BackupUploadsRequest } from '@core/schema/config/listS3BackupUploads/request.schema';
import { S3BackupUploadsListerUseCase } from '@core/useCases/config/S3BackupUploadsLister.useCase';

export const listS3BackupUploads = async (
  request: FastifyRequest<{
    Querystring: ListS3BackupUploadsRequest;
  }>,
  reply: FastifyReply
) => {
  const s3BackupUploadsListerUseCase = container.resolve(
    S3BackupUploadsListerUseCase
  );
  const { t } = request;

  try {
    const response = await s3BackupUploadsListerUseCase.execute(request.query);

    return sendResponse(reply, {
      message: t('s3_backup_uploads_listed_successfully'),
      httpStatusCode: EHTTPStatusCode.ok,
      data: response,
    });
  } catch (error) {
    handleControllerError(error, reply, t);
  }
};
