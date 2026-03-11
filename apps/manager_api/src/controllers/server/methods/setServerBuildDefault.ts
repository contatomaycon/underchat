import { EHTTPStatusCode } from '@core/common/enums/EHTTPStatusCode';
import { sendResponse } from '@core/common/functions/sendResponse';
import { handleControllerError } from '@core/common/functions/handleControllerError';
import { FastifyReply, FastifyRequest } from 'fastify';
import { container } from 'tsyringe';
import { ServerBuildDefaultParams } from '@core/schema/server/setServerBuildDefault/request.schema';
import { ServerBuildDefaultUpdaterUseCase } from '@core/useCases/server/ServerBuildDefaultUpdater.useCase';

export const setServerBuildDefault = async (
  request: FastifyRequest<{
    Params: ServerBuildDefaultParams;
  }>,
  reply: FastifyReply
) => {
  const serverBuildDefaultUpdaterUseCase = container.resolve(
    ServerBuildDefaultUpdaterUseCase
  );
  const { t } = request;

  try {
    const response = await serverBuildDefaultUpdaterUseCase.execute(
      request.params.server_build_version_id
    );

    if (!response) {
      return sendResponse(reply, {
        message: t('server_build_default_not_found'),
        httpStatusCode: EHTTPStatusCode.bad_request,
      });
    }

    return sendResponse(reply, {
      message: t('server_build_default_update_success'),
      httpStatusCode: EHTTPStatusCode.ok,
      data: response,
    });
  } catch (error) {
    handleControllerError(error, reply, t);
  }
};
