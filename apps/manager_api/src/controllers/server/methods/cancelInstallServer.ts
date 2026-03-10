import { EHTTPStatusCode } from '@core/common/enums/EHTTPStatusCode';
import { sendResponse } from '@core/common/functions/sendResponse';
import { handleControllerError } from '@core/common/functions/handleControllerError';
import { FastifyReply, FastifyRequest } from 'fastify';
import { container } from 'tsyringe';
import { CancelInstallServerParamsRequest } from '@core/schema/server/cancelInstallServer/request.schema';
import { ServerCancelInstallUseCase } from '@core/useCases/server/ServerCancelInstall.useCase';

export const cancelInstallServer = async (
  request: FastifyRequest<{
    Params: CancelInstallServerParamsRequest;
  }>,
  reply: FastifyReply
) => {
  const serverCancelInstallUseCase = container.resolve(
    ServerCancelInstallUseCase
  );
  const { t } = request;

  try {
    const response = await serverCancelInstallUseCase.execute(
      t,
      request.params.server_id
    );

    if (response) {
      return sendResponse(reply, {
        message: t('server_cancel_install_successfully'),
        httpStatusCode: EHTTPStatusCode.ok,
      });
    }

    return sendResponse(reply, {
      message: t('server_cancel_install_failed'),
      httpStatusCode: EHTTPStatusCode.bad_request,
    });
  } catch (error) {
    handleControllerError(error, reply, t);
  }
};
