import { EHTTPStatusCode } from '@core/common/enums/EHTTPStatusCode';
import { sendResponse } from '@core/common/functions/sendResponse';
import { FastifyReply, FastifyRequest } from 'fastify';
import { container } from 'tsyringe';
import { DeleteServerRequest } from '@core/schema/server/deleteServer/request.schema';
import { ServerDeleterUseCase } from '@core/useCases/server/ServerDeleter.useCase';

export const deleteServer = async (
  request: FastifyRequest<{
    Params: DeleteServerRequest;
  }>,
  reply: FastifyReply
) => {
  const serverDeleterUseCase = container.resolve(ServerDeleterUseCase);
  const { t } = request;

  try {
    const response = await serverDeleterUseCase.execute(
      t,
      request.params.server_id
    );

    if (response) {
      return sendResponse(reply, {
        message: t('server_deleted_successfully'),
        httpStatusCode: EHTTPStatusCode.ok,
      });
    }

    request.server.logger.info(response, request.id);

    return sendResponse(reply, {
      message: t('server_deleter_error'),
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
