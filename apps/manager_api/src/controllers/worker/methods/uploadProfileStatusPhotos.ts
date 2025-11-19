import { EHTTPStatusCode } from '@core/common/enums/EHTTPStatusCode';
import { sendResponse } from '@core/common/functions/sendResponse';
import { FastifyReply, FastifyRequest } from 'fastify';
import { container } from 'tsyringe';
import { WorkerProfileStatusUploaderUseCase } from '@core/useCases/worker/WorkerProfileStatusUploader.useCase';
import {
  UploadProfileStatusPhotosParams,
  UploadProfileStatusPhotosRequest,
} from '@core/schema/worker/uploadProfileStatusPhotos/request.schema';

export const uploadProfileStatusPhotos = async (
  request: FastifyRequest<{
    Params: UploadProfileStatusPhotosParams;
    Body: UploadProfileStatusPhotosRequest;
  }>,
  reply: FastifyReply
) => {
  const workerProfileStatusUploaderUseCase = container.resolve(
    WorkerProfileStatusUploaderUseCase
  );
  const { t, tokenJwtData } = request;
  const { worker_id } = request.params;
  const { photos, is_permanent } = request.body;

  try {
    const response = await workerProfileStatusUploaderUseCase.execute(
      t,
      tokenJwtData.account_id,
      worker_id,
      photos,
      is_permanent
    );

    if (response) {
      return sendResponse(reply, {
        message: t('profile_status_upload_success'),
        httpStatusCode: EHTTPStatusCode.ok,
        data: response,
      });
    }

    return sendResponse(reply, {
      message: t('profile_status_upload_error'),
      httpStatusCode: EHTTPStatusCode.bad_request,
    });
  } catch (error) {
    request.server.logger.error(error, request.id);

    if (error instanceof Error) {
      return sendResponse(reply, {
        message: error.message,
        httpStatusCode: EHTTPStatusCode.internal_server_error,
      });
    }

    return sendResponse(reply, {
      message: t('internal_server_error'),
      httpStatusCode: EHTTPStatusCode.internal_server_error,
    });
  }
};
