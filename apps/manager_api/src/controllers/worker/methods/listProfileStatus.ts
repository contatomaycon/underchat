import { EHTTPStatusCode } from '@core/common/enums/EHTTPStatusCode';
import { sendResponse } from '@core/common/functions/sendResponse';
import { FastifyReply, FastifyRequest } from 'fastify';
import { container } from 'tsyringe';
import { WorkerProfileStatusListerUseCase } from '@core/useCases/worker/WorkerProfileStatusLister.useCase';

export const listProfileStatus = async (
  request: FastifyRequest<{
    Params: { worker_id: string };
  }>,
  reply: FastifyReply
) => {
  const workerProfileStatusListerUseCase = container.resolve(
    WorkerProfileStatusListerUseCase
  );
  const { t, tokenJwtData } = request;
  const { worker_id } = request.params;

  try {
    const response = await workerProfileStatusListerUseCase.execute(
      t,
      tokenJwtData.account_id,
      tokenJwtData.is_administrator,
      worker_id
    );

    if (response) {
      return sendResponse(reply, {
        message: t('profile_status_load_success'),
        httpStatusCode: EHTTPStatusCode.ok,
        data: response,
      });
    }

    return sendResponse(reply, {
      message: t('profile_status_load_error'),
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
