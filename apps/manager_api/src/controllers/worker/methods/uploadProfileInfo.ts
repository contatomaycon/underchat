import { EHTTPStatusCode } from '@core/common/enums/EHTTPStatusCode';
import { sendResponse } from '@core/common/functions/sendResponse';
import { handleControllerError } from '@core/common/functions/handleControllerError';
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
    handleControllerError(error, reply, t);
  }
};
