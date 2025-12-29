import { EHTTPStatusCode } from '@core/common/enums/EHTTPStatusCode';
import { sendResponse } from '@core/common/functions/sendResponse';
import { handleControllerError } from '@core/common/functions/handleControllerError';
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
    const response = await serverUpdaterUseCase.execute(
      t,
      request.params.server_id,
      request.body
    );

    if (response) {
      return sendResponse(reply, {
        message: t('server_update_successfully'),
        httpStatusCode: EHTTPStatusCode.ok,
      });
    }

    return sendResponse(reply, {
      message: t('server_update_error'),
      httpStatusCode: EHTTPStatusCode.bad_request,
    });
  } catch (error) {
    handleControllerError(error, reply, t);
  }
};
