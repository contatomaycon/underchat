import { EHTTPStatusCode } from '@core/common/enums/EHTTPStatusCode';
import { sendResponse } from '@core/common/functions/sendResponse';
import { FastifyReply, FastifyRequest } from 'fastify';
import { container } from 'tsyringe';
import { WorkerProfileInfoUpserterUseCase } from '@core/useCases/worker/WorkerProfileInfoUpserter.useCase';
import {
  UploadProfileInfoParams,
  UploadProfileInfoRequest,
} from '@core/schema/worker/uploadProfileInfo/request.schema';

export const uploadProfileInfo = async (
  request: FastifyRequest<{
    Params: UploadProfileInfoParams;
    Body: UploadProfileInfoRequest;
  }>,
  reply: FastifyReply
) => {
  const workerProfileInfoUpserterUseCase = container.resolve(
    WorkerProfileInfoUpserterUseCase
  );
  const { t, tokenJwtData } = request;
  const { worker_id } = request.params;
  const body = request.body;

  try {
    const response = await workerProfileInfoUpserterUseCase.execute(
      t,
      tokenJwtData.account_id,
      tokenJwtData.is_administrator,
      worker_id,
      body
    );

    if (response) {
      return sendResponse(reply, {
        message: t('profile_info_upload_success'),
        httpStatusCode: EHTTPStatusCode.ok,
        data: response,
      });
    }

    return sendResponse(reply, {
      message: t('profile_info_upload_error'),
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
