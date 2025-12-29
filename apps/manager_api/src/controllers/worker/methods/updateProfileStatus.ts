import { EHTTPStatusCode } from '@core/common/enums/EHTTPStatusCode';
import { sendResponse } from '@core/common/functions/sendResponse';
import { handleControllerError } from '@core/common/functions/handleControllerError';
import { FastifyReply, FastifyRequest } from 'fastify';
import { container } from 'tsyringe';
import { WorkerProfileStatusUpdaterUseCase } from '@core/useCases/worker/WorkerProfileStatusUpdater.useCase';
import {
  UpdateProfileStatusParams,
  UpdateProfileStatusRequest,
} from '@core/schema/worker/updateProfileStatus/request.schema';

export const updateProfileStatus = async (
  request: FastifyRequest<{
    Params: UpdateProfileStatusParams;
    Body: UpdateProfileStatusRequest;
  }>,
  reply: FastifyReply
) => {
  const workerProfileStatusUpdaterUseCase = container.resolve(
    WorkerProfileStatusUpdaterUseCase
  );
  const { t, tokenJwtData } = request;
  const { worker_profile_status_id } = request.params;
  const body = request.body;

  try {
    const response = await workerProfileStatusUpdaterUseCase.execute(
      t,
      worker_profile_status_id,
      tokenJwtData.account_id,
      body
    );

    if (response) {
      return sendResponse(reply, {
        message: t('profile_status_update_success'),
        httpStatusCode: EHTTPStatusCode.ok,
      });
    }

    return sendResponse(reply, {
      message: t('profile_status_update_error'),
      httpStatusCode: EHTTPStatusCode.bad_request,
    });
  } catch (error) {
    handleControllerError(error, reply, t);
  }
};
