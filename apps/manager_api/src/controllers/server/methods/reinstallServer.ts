import { EHTTPStatusCode } from '@core/common/enums/EHTTPStatusCode';
import { sendResponse } from '@core/common/functions/sendResponse';
import { handleControllerError } from '@core/common/functions/handleControllerError';
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

    return sendResponse(reply, {
      message: t('server_reinstall_failed'),
      httpStatusCode: EHTTPStatusCode.bad_request,
    });
  } catch (error) {
    handleControllerError(error, reply, t);
  }
};
