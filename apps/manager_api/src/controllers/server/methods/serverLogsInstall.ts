import { EHTTPStatusCode } from '@core/common/enums/EHTTPStatusCode';
import { sendResponse } from '@core/common/functions/sendResponse';
import { handleControllerError } from '@core/common/functions/handleControllerError';
import { FastifyReply, FastifyRequest } from 'fastify';
import { container } from 'tsyringe';
import {
  ServerLogsInstallQuery,
  ServerLogsInstallRequest,
} from '@core/schema/server/serverLogsInstall/request.schema';
import { ServerLogsInstallUseCase } from '@core/useCases/server/ServerLogsInstall.useCase';

export const serverLogsInstall = async (
  request: FastifyRequest<{
    Params: ServerLogsInstallRequest;
    Querystring: ServerLogsInstallQuery;
  }>,
  reply: FastifyReply
) => {
  const serverLogsInstallUseCase = container.resolve(ServerLogsInstallUseCase);
  const { t } = request;

  try {
    const response = await serverLogsInstallUseCase.execute(
      t,
      request.params.server_id,
      request.query
    );

    if (response) {
      return sendResponse(reply, {
        message: t('server_logs_install_success'),
        httpStatusCode: EHTTPStatusCode.ok,
        data: response,
      });
    }

    return sendResponse(reply, {
      message: t('server_logs_install_not_found'),
      httpStatusCode: EHTTPStatusCode.bad_request,
    });
  } catch (error) {
    handleControllerError(error, reply, t);
  }
};
