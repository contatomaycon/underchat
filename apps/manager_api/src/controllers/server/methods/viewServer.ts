import { EHTTPStatusCode } from '@core/common/enums/EHTTPStatusCode';
import { sendResponse } from '@core/common/functions/sendResponse';
import { FastifyReply, FastifyRequest } from 'fastify';
import { container } from 'tsyringe';
import { ViewServerRequest } from '@core/schema/server/viewServer/request.schema';
import { ServerViewerUseCase } from '@core/useCases/server/ServerViewer.useCase';

export const viewServer = async (
  request: FastifyRequest<{
    Params: ViewServerRequest;
  }>,
  reply: FastifyReply
) => {
  const serverViewerUseCase = container.resolve(ServerViewerUseCase);
  const { t } = request;

  try {
    const response = await serverViewerUseCase.execute(
      t,
      request.params.server_id
    );

    if (response) {
      return sendResponse(reply, {
        message: t('server_view_successfully'),
        httpStatusCode: EHTTPStatusCode.ok,
        data: response,
      });
    }

    request.server.logger.info(response, request.id);

    return sendResponse(reply, {
      message: t('server_not_found'),
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
