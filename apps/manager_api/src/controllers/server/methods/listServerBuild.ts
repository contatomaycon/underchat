import { EHTTPStatusCode } from '@core/common/enums/EHTTPStatusCode';
import { sendResponse } from '@core/common/functions/sendResponse';
import { handleControllerError } from '@core/common/functions/handleControllerError';
import { FastifyReply, FastifyRequest } from 'fastify';
import { container } from 'tsyringe';
import { ServerBuildViewerUseCase } from '@core/useCases/server/ServerBuildViewer.useCase';

export const listServerBuild = async (
  request: FastifyRequest,
  reply: FastifyReply
) => {
  const serverBuildViewerUseCase = container.resolve(ServerBuildViewerUseCase);
  const { t } = request;

  try {
    const response = await serverBuildViewerUseCase.execute();

    return sendResponse(reply, {
      message: t('server_build_list_success'),
      httpStatusCode: EHTTPStatusCode.ok,
      data: response,
    });
  } catch (error) {
    handleControllerError(error, reply, t);
  }
};
