import { EHTTPStatusCode } from '@core/common/enums/EHTTPStatusCode';
import { sendResponse } from '@core/common/functions/sendResponse';
import { FastifyReply, FastifyRequest } from 'fastify';
import { container } from 'tsyringe';
import { WorkerProfileStatusDeleterUseCase } from '@core/useCases/worker/WorkerProfileStatusDeleter.useCase';
import { DeleteProfileStatusRequest } from '@core/schema/worker/deleteProfileStatus/request.schema';

export const deleteProfileStatus = async (
  request: FastifyRequest<{
    Params: DeleteProfileStatusRequest;
  }>,
  reply: FastifyReply
) => {
  const workerProfileStatusDeleterUseCase = container.resolve(
    WorkerProfileStatusDeleterUseCase
  );
  const { t, tokenJwtData } = request;
  const { worker_profile_status_id } = request.params;

  try {
    const response = await workerProfileStatusDeleterUseCase.execute(
      t,
      worker_profile_status_id,
      tokenJwtData.account_id,
      tokenJwtData.is_administrator
    );

    if (response) {
      return sendResponse(reply, {
        message: t('profile_status_delete_success'),
        httpStatusCode: EHTTPStatusCode.ok,
      });
    }

    return sendResponse(reply, {
      message: t('profile_status_delete_error'),
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
