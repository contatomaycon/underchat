import { EHTTPStatusCode } from '@core/common/enums/EHTTPStatusCode';
import { sendResponse } from '@core/common/functions/sendResponse';
import { FastifyReply, FastifyRequest } from 'fastify';
import { container } from 'tsyringe';
import { WorkerProfileStatusUploaderUseCase } from '@core/useCases/worker/WorkerProfileStatusUploader.useCase';
import {
  UploadProfileStatusParams,
  UploadProfileStatusRequest,
} from '@core/schema/worker/uploadProfileStatus/request.schema';

export const uploadProfileStatus = async (
  request: FastifyRequest<{
    Params: UploadProfileStatusParams;
    Body: UploadProfileStatusRequest;
  }>,
  reply: FastifyReply
) => {
  const workerProfileStatusUploaderUseCase = container.resolve(
    WorkerProfileStatusUploaderUseCase
  );
  const { t, tokenJwtData } = request;
  const { worker_id } = request.params;
  const body = request.body;

  try {
    const response = await workerProfileStatusUploaderUseCase.execute(
      t,
      tokenJwtData.account_id,
      worker_id,
      body
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
