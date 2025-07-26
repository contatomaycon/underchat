import { EHTTPStatusCode } from '@core/common/enums/EHTTPStatusCode';
import { sendResponse } from '@core/common/functions/sendResponse';
import { FastifyReply, FastifyRequest } from 'fastify';
import { container } from 'tsyringe';
import { ReinstallServerParamsRequest } from '@core/schema/server/reinstallServer/request.schema';
import { ServerReinstallServerUseCase } from '@core/useCases/server/ServerReinstallServer.useCase';

export const reinstallServer = async (
  request: FastifyRequest<{
    Params: ReinstallServerParamsRequest;
  }>,
  reply: FastifyReply
) => {
  const serverReinstallServerUseCase = container.resolve(
    ServerReinstallServerUseCase
  );
  const { t } = request;

  try {
    const response = await serverReinstallServerUseCase.execute(
      t,
      request.params.server_id
    );

    if (response) {
      return sendResponse(reply, {
        message: t('server_reinstall_successfully'),
        httpStatusCode: EHTTPStatusCode.ok,
      });
    }

    request.server.logger.info(response, request.id);

    return sendResponse(reply, {
      message: t('server_reinstall_failed'),
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
