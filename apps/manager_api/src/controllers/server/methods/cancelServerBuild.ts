import { EHTTPStatusCode } from '@core/common/enums/EHTTPStatusCode';
import { sendResponse } from '@core/common/functions/sendResponse';
import { handleControllerError } from '@core/common/functions/handleControllerError';
import { FastifyReply, FastifyRequest } from 'fastify';
import { container } from 'tsyringe';
import { ServerBuildCancellerUseCase } from '@core/useCases/server/ServerBuildCanceller.useCase';

export const cancelServerBuild = async (
  request: FastifyRequest,
  reply: FastifyReply
) => {
  const serverBuildCancellerUseCase = container.resolve(
    ServerBuildCancellerUseCase
  );
  const { t } = request;

  try {
    const response = await serverBuildCancellerUseCase.execute(t);

    if (!response) {
      return sendResponse(reply, {
        message: t('server_build_cancel_not_found'),
        httpStatusCode: EHTTPStatusCode.bad_request,
      });
    }

    return sendResponse(reply, {
      message: t('server_build_cancel_success'),
      httpStatusCode: EHTTPStatusCode.ok,
    });
  } catch (error) {
    handleControllerError(error, reply, t);
  }
};
