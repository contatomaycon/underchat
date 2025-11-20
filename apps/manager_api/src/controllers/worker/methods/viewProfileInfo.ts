import { EHTTPStatusCode } from '@core/common/enums/EHTTPStatusCode';
import { sendResponse } from '@core/common/functions/sendResponse';
import { FastifyReply, FastifyRequest } from 'fastify';
import { container } from 'tsyringe';
import { WorkerProfileInfoViewerUseCase } from '@core/useCases/worker/WorkerProfileInfoViewer.useCase';
import { ViewProfileInfoParams } from '@core/schema/worker/viewProfileInfo/request.schema';

export const viewProfileInfo = async (
  request: FastifyRequest<{
    Params: ViewProfileInfoParams;
  }>,
  reply: FastifyReply
) => {
  const workerProfileInfoViewerUseCase = container.resolve(
    WorkerProfileInfoViewerUseCase
  );
  const { t, tokenJwtData } = request;
  const { worker_id } = request.params;

  try {
    const response = await workerProfileInfoViewerUseCase.execute(
      t,
      tokenJwtData.account_id,
      tokenJwtData.is_administrator,
      worker_id
    );

    return sendResponse(reply, {
      message: t('profile_info_view_success'),
      httpStatusCode: EHTTPStatusCode.ok,
      data: response,
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
