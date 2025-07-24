import { EHTTPStatusCode } from '@core/common/enums/EHTTPStatusCode';
import { sendResponse } from '@core/common/functions/sendResponse';
import { FastifyReply, FastifyRequest } from 'fastify';
import { container } from 'tsyringe';
import {
  EditServerParamsRequest,
  EditServerRequest,
} from '@core/schema/server/editServer/request.schema';
import { ServerUpdaterUseCase } from '@core/useCases/server/ServerUpdater.useCase';

export const editServer = async (
  request: FastifyRequest<{
    Body: EditServerRequest;
    Params: EditServerParamsRequest;
  }>,
  reply: FastifyReply
) => {
  const serverUpdaterUseCase = container.resolve(ServerUpdaterUseCase);
  const { t } = request;

  try {
    const responseCreatorServer = await serverUpdaterUseCase.execute(
      t,
      request.params.server_id,
      request.body
    );

    if (responseCreatorServer) {
      return sendResponse(reply, {
        message: t('server_update_successfully'),
        httpStatusCode: EHTTPStatusCode.ok,
      });
    }

    request.server.logger.info(responseCreatorServer, request.id);

    return sendResponse(reply, {
      message: t('server_update_error'),
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
