import { EHTTPStatusCode } from '@core/common/enums/EHTTPStatusCode';
import { handleControllerError } from '@core/common/functions/handleControllerError';
import { sendResponse } from '@core/common/functions/sendResponse';
import { ServerBuildPairUseCase } from '@core/useCases/server/ServerBuildPair.useCase';
import { FastifyReply, FastifyRequest } from 'fastify';
import { container } from 'tsyringe';

export const pairServerBuild = async (
  request: FastifyRequest,
  reply: FastifyReply
) => {
  const { t } = request;
  const serverBuildPairUseCase = container.resolve(ServerBuildPairUseCase);

  try {
    const response = await serverBuildPairUseCase.execute();

    return sendResponse(reply, {
      message: t('server_build_pair_success'),
      httpStatusCode: EHTTPStatusCode.ok,
      data: response,
    });
  } catch (error) {
    handleControllerError(error, reply, t);
  }
};
