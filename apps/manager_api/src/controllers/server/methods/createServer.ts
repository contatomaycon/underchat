import { EHTTPStatusCode } from '@core/common/enums/EHTTPStatusCode';
import { sendResponse } from '@core/common/functions/sendResponse';
import { FastifyReply, FastifyRequest } from 'fastify';
import { container } from 'tsyringe';
import { ServerCreatorUseCase } from '@core/useCases/server/ServerCreator.useCase';
import { CreateServerRequest } from '@core/schema/server/createServer/request.schema';

export const createServer = async (
  request: FastifyRequest<{
    Body: CreateServerRequest;
  }>,
  reply: FastifyReply
) => {
  const serverCreatorUseCase = container.resolve(ServerCreatorUseCase);
  const { t } = request;

  try {
    const response = await serverCreatorUseCase.execute(t, request.body);

    if (response) {
      return sendResponse(reply, {
        message: t('server_creator_success'),
        httpStatusCode: EHTTPStatusCode.ok,
        data: response,
      });
    }

    request.server.logger.info(response, request.id);

    return sendResponse(reply, {
      message: t('server_creator_error'),
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
