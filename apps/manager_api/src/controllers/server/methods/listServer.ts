import { EHTTPStatusCode } from '@core/common/enums/EHTTPStatusCode';
import { sendResponse } from '@core/common/functions/sendResponse';
import { handleControllerError } from '@core/common/functions/handleControllerError';
import { FastifyReply, FastifyRequest } from 'fastify';
import { container } from 'tsyringe';
import { ListServerRequest } from '@core/schema/server/listServer/request.schema';
import { ServerListerUseCase } from '@core/useCases/server/ServerLister.useCase';

export const listServer = async (
  request: FastifyRequest<{
    Querystring: ListServerRequest;
  }>,
  reply: FastifyReply
) => {
  const serverListerUseCase = container.resolve(ServerListerUseCase);
  const { t } = request;

  try {
    const response = await serverListerUseCase.execute(t, request.query);

    if (response) {
      return sendResponse(reply, {
        message: t('server_list_successfully'),
        httpStatusCode: EHTTPStatusCode.ok,
        data: response,
      });
    }

    return sendResponse(reply, {
      message: t('server_list_not_found'),
      httpStatusCode: EHTTPStatusCode.bad_request,
    });
  } catch (error) {
    handleControllerError(error, reply, t);
  }
};
