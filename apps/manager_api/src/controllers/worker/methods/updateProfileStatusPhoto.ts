import { EHTTPStatusCode } from '@core/common/enums/EHTTPStatusCode';
import { sendResponse } from '@core/common/functions/sendResponse';
import { FastifyReply, FastifyRequest } from 'fastify';
import { container } from 'tsyringe';
import { WorkerProfileStatusUpdaterUseCase } from '@core/useCases/worker/WorkerProfileStatusUpdater.useCase';
import {
  UpdateProfileStatusPhotoParams,
  UpdateProfileStatusPhotoRequest,
} from '@core/schema/worker/updateProfileStatusPhoto/request.schema';

export const updateProfileStatusPhoto = async (
  request: FastifyRequest<{
    Params: UpdateProfileStatusPhotoParams;
    Body: UpdateProfileStatusPhotoRequest;
  }>,
  reply: FastifyReply
) => {
  const workerProfileStatusUpdaterUseCase = container.resolve(
    WorkerProfileStatusUpdaterUseCase
  );
  const { t } = request;
  const { worker_profile_status_id } = request.params;
  const { is_permanent } = request.body;

  try {
    const response = await workerProfileStatusUpdaterUseCase.execute(
      t,
      worker_profile_status_id,
      is_permanent
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
